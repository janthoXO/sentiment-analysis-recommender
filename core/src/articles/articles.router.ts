import { Router } from "express";
import z from "zod";
import type { ArticlesService } from "./articles.service.js";

const zArticlesQuery = z.object({
  tickerIds: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v])),
});

const zTickerArticlesQuery = z.object({
  eventTSec: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v == null ? undefined : (Array.isArray(v) ? v : [v]).map(Number)
    ),
  intervalSec: z
    .string()
    .optional()
    .transform((v) => (v != null ? Number(v) : undefined)),
});

function startNdjsonStream(res: import("express").Response) {
  res.contentType("application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
}

export function makeArticlesRouter({
  articlesService,
}: {
  articlesService: ArticlesService;
}) {
  const router = Router();

  // GET /api/tickers/articles — Stage 2 (multi-ticker)
  router.get("/articles", async (req, res): Promise<void> => {
    const parsed = zArticlesQuery.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "tickerIds is required", code: "MISSING_PARAM" });
      return;
    }

    startNdjsonStream(res);

    try {
      for await (const chunk of articlesService.streamArticlesByTickerIds(
        parsed.data.tickerIds
      )) {
        res.write(JSON.stringify(chunk) + "\n");
      }
      res.end();
    } catch (e) {
      console.error("Articles stream error:", e);
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
  });

  // GET /api/tickers/:tickerId/articles — Stage 2 (single ticker, event-aware)
  router.get("/:tickerId/articles", async (req, res): Promise<void> => {
    const ticker = String(req.params["tickerId"] ?? "")
      .toUpperCase()
      .trim();
    if (!ticker) {
      res
        .status(400)
        .json({ error: "tickerId is required", code: "MISSING_TICKER" });
      return;
    }

    const parsed = zTickerArticlesQuery.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid query parameters", code: "VALIDATION_FAILED" });
      return;
    }

    startNdjsonStream(res);

    try {
      for await (const chunk of articlesService.streamArticlesForTicker(
        ticker,
        parsed.data
      )) {
        res.write(JSON.stringify(chunk) + "\n");
      }
      res.end();
    } catch (e) {
      console.error(`Articles stream error for ${ticker}:`, e);
      if (!res.headersSent) {
        res.status(503).json({
          error: "Article data unavailable",
          code: "UPSTREAM_UNAVAILABLE",
        });
      } else {
        res.end();
      }
    }
  });

  return router;
}
