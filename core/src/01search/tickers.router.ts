import { Router } from "express";
import type { Request, Response } from "express";
import {
  analyzeStock,
  streamSentiment,
  yieldAsResolved,
} from "./sentiment.service.js";
import {
  zGetApiTickersByTickerIdPeersPath,
  zGetApiTickersSentimentQuery,
  zGetApiTickersByTickerIdSentimentQuery,
} from "@/generated/in/zod.gen.js";
import {
  enrichStockProfile,
  getCompanyPeers,
  searchTickers,
} from "@/stocks/stocks.api.js";
import { getPeersCache, setPeersCache } from "./stock.cache.js";
import { getTickerStock, upsertTickerStock } from "./ticker-stock.repo.js";
import type { StockRoot } from "@/generated/in/index.js";
import { getTrackersByPriority } from "@/01tracker/tracker.repo.js";
import { asyncHandler, HttpError } from "@/middleware/httpError.js";

const tickersRouter = Router();

// Streaming handlers cannot use asyncHandler because headers may already be sent
// when a per-ticker error occurs. They write errors into the NDJSON stream instead.
tickersRouter.get(
  "/sentiment",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = zGetApiTickersSentimentQuery.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid query parameters", code: "VALIDATION_FAILED" });
      return;
    }

    const { q, tickerIds } = parsed.data;

    if (!q && (!tickerIds || tickerIds.length === 0)) {
      res.status(400).json({
        error: "Either q or tickerIds must be provided",
        code: "MISSING_PARAM",
      });
      return;
    }

    res.contentType("application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    const input: Parameters<typeof streamSentiment>[0] = q
      ? { q }
      : { tickerIds: tickerIds! };

    try {
      for await (const chunk of streamSentiment(input)) {
        res.write(JSON.stringify(chunk) + "\n");
      }
      res.end();
    } catch (e) {
      console.error("Tickers sentiment router error:", e);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Internal server error", code: "INTERNAL" });
      } else {
        res.write(
          JSON.stringify({ error: "Internal server error", code: "INTERNAL" }) +
            "\n"
        );
        res.end();
      }
    }
  }
);

tickersRouter.get(
  "/:tickerId/sentiment",
  async (req: Request, res: Response): Promise<void> => {
    const ticker = String(req.params["tickerId"] ?? "")
      .toUpperCase()
      .trim();
    if (!ticker) {
      res
        .status(400)
        .json({ error: "tickerId is required", code: "MISSING_TICKER" });
      return;
    }

    const rawQ = req.query as Record<string, string | string[]>;
    const coercedQuery = {
      eventTSec:
        rawQ["eventTSec"] != null
          ? ([] as string[])
              .concat(rawQ["eventTSec"] as string | string[])
              .map(Number)
          : undefined,
      intervalSec:
        rawQ["intervalSec"] != null ? Number(rawQ["intervalSec"]) : undefined,
    };
    const parsed =
      zGetApiTickersByTickerIdSentimentQuery.safeParse(coercedQuery);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid query parameters", code: "VALIDATION_FAILED" });
      return;
    }

    const { eventTSec, intervalSec } = parsed.data;
    const stock: StockRoot = await enrichStockProfile(
      (await getTickerStock(ticker)) ?? {
        ticker,
        name: ticker,
      }
    );

    res.contentType("application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    try {
      if (eventTSec?.length) {
        const promises = eventTSec.map((t) =>
          analyzeStock({ stock, eventTSec: t, intervalSec, priority: 3 }).catch(
            (e) => {
              console.error(`Error analyzing ${ticker} at event ${t}:`, e);
              return {
                error: e instanceof Error ? e.message : "Analysis failed",
                code: e instanceof HttpError ? e.code : "ANALYSIS_FAILED",
                ticker,
              };
            }
          )
        );
        for await (const result of yieldAsResolved(promises)) {
          if (result !== null) res.write(JSON.stringify(result) + "\n");
        }
      } else {
        const result = await analyzeStock({
          stock,
          intervalSec,
          priority: 4,
        }).catch((e) => {
          console.error(`Error analyzing ${ticker}:`, e);
          return {
            error: e instanceof Error ? e.message : "Analysis failed",
            code: e instanceof HttpError ? e.code : "ANALYSIS_FAILED",
            ticker,
          };
        });
        if (result !== null) res.write(JSON.stringify(result) + "\n");
      }

      res.end();
    } catch (e) {
      console.error("Single ticker sentiment router error:", e);
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

tickersRouter.get(
  "/:tickerId/peers",
  asyncHandler(async (req, res) => {
    const { tickerId: rawTicker } = zGetApiTickersByTickerIdPeersPath.parse(
      req.params
    );
    const ticker = rawTicker.toUpperCase().trim();

    let peers = await getPeersCache(ticker);
    if (!peers) {
      peers = await getCompanyPeers(ticker);
      await setPeersCache(ticker, peers);
    }

    const enriched: (StockRoot | null)[] = await Promise.all(
      peers.map(async (t) => {
        try {
          const stock = await getTickerStock(t);

          if (!stock) {
            const stocks = await searchTickers(t);
            const exact = stocks.find((s) => s.ticker.toUpperCase() === t);
            if (exact) {
              const enrichedExact = await enrichStockProfile(exact);
              await upsertTickerStock(enrichedExact);
              return enrichedExact;
            }
          }

          return enrichStockProfile(stock ?? { ticker: t, name: t });
        } catch (e) {
          console.error(`Error enriching peer ${t}:`, e);
          return null;
        }
      })
    );

    res.json(enriched.filter((s) => !!s));
  })
);

tickersRouter.get(
  "/trending",
  asyncHandler(async (_req, res) => {
    const trackers = await getTrackersByPriority(2);
    const stocks: StockRoot[] = trackers.map((t) => ({
      ticker: t.ticker,
      name: t.name,
    }));
    res.json(stocks);
  })
);

export default tickersRouter;
