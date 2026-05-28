import { Router } from "express";
import type { TickerStockRepo } from "@/stocks/ticker-stock.repo.js";

function startNdjsonStream(res: import("express").Response) {
  res.contentType("application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
}

export function makeTrendsRouter({
  stockRepo,
}: {
  stockRepo: TickerStockRepo;
}) {
  const router = Router();

  // GET /api/tickers/trending
  router.get("/trending", async (_req, res): Promise<void> => {
    startNdjsonStream(res);
    try {
      const stocks = await stockRepo.getTrendingStocks();
      for (const stock of stocks) {
        res.write(JSON.stringify(stock) + "\n");
      }
      res.end();
    } catch (e) {
      console.error("Trending stream error:", e);
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

  return router;
}
