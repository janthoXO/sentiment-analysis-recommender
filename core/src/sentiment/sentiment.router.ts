import { Router } from "express";
import z from "zod";
import type { SourceRoot, StockRoot } from "../generated/in/index.js";
import type { SentimentService } from "./sentiment.service.js";
import type { InvestmentInsightService } from "./investment-insight.service.js";
import type { TickerStockRepo } from "../stocks/ticker-stock.repo.js";

const zSentimentQuery = z.object({
  articleUrl: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v])),
});

const zInsightQuery = zSentimentQuery;

function startNdjsonStream(res: import("express").Response) {
  res.contentType("application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
}

export function makeSentimentRouter({
  sentimentService,
  tickerStockRepo,
  investmentInsightService,
}: {
  sentimentService: SentimentService;
  tickerStockRepo: TickerStockRepo;
  investmentInsightService: InvestmentInsightService;
}) {
  const router = Router();

  // GET /api/tickers/:tickerId/articles/sentiment — Stage 3: stream scores
  router.get(
    "/:tickerId/articles/sentiment",
    async (req, res): Promise<void> => {
      const ticker = String(req.params["tickerId"] ?? "")
        .toUpperCase()
        .trim();
      if (!ticker) {
        res
          .status(400)
          .json({ error: "tickerId is required", code: "MISSING_TICKER" });
        return;
      }

      const parsed = zSentimentQuery.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "articleUrl is required", code: "MISSING_PARAM" });
        return;
      }

      const stock: StockRoot = (await tickerStockRepo.getTickerStock(
        ticker
      )) ?? { ticker, name: ticker };
      // Reconstruct minimal SourceRoot objects; metadata was persisted by the articles endpoint
      const sources: SourceRoot[] = parsed.data.articleUrl.map((url) => ({
        url,
        title: "",
        body: "",
        updatedAtSec: 0,
        scrapedAtSec: 0,
      }));

      startNdjsonStream(res);

      try {
        for await (const chunk of sentimentService.streamSentimentForArticles(
          stock,
          sources
        )) {
          res.write(JSON.stringify(chunk) + "\n");
        }
        res.end();
      } catch (e) {
        console.error(`Sentiment stream error for ${ticker}:`, e);
        if (!res.headersSent) {
          res.status(503).json({
            error: "Sentiment data unavailable",
            code: "UPSTREAM_UNAVAILABLE",
          });
        } else {
          res.end();
        }
      }
    }
  );

  // GET /api/tickers/:tickerId/articles/insight — cached LLM explanation for scored articles
  router.get("/:tickerId/articles/insight", async (req, res): Promise<void> => {
    const ticker = String(req.params["tickerId"] ?? "")
      .toUpperCase()
      .trim();
    if (!ticker) {
      res
        .status(400)
        .json({ error: "tickerId is required", code: "MISSING_TICKER" });
      return;
    }

    const parsed = zInsightQuery.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "articleUrl is required", code: "MISSING_PARAM" });
      return;
    }

    try {
      const stock: StockRoot = (await tickerStockRepo.getTickerStock(
        ticker
      )) ?? { ticker, name: ticker };

      const insight = await investmentInsightService.getInvestmentInsight(
        stock,
        parsed.data.articleUrl
      );

      if (!insight) {
        res.status(204).end();
        return;
      }

      res.json(insight);
    } catch (e) {
      console.error(`Investment insight error for ${ticker}:`, e);
      res.status(503).json({
        error: "Investment insight unavailable",
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
  });

  return router;
}
