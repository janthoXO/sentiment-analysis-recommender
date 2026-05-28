import { Router } from "express";
import z from "zod";
import { zGetApiTickersByTickerIdPeersPath } from "../generated/in/zod.gen.js";
import type { StockRoot } from "../generated/in/index.js";
import type { StocksService } from "./stocks.service.js";
import type { StockCacheService } from "./stock.cache.js";
import type { TickerStockRepo } from "./ticker-stock.repo.js";

async function* yieldAsResolved<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  const pending = new Map<number, Promise<{ index: number; value: T }>>();
  promises.forEach((p, i) => {
    pending.set(
      i,
      p.then((value) => ({ index: i, value }))
    );
  });
  while (pending.size > 0) {
    const { index, value } = await Promise.race(pending.values());
    pending.delete(index);
    yield value;
  }
}

const zTickersQuery = z.object({
  q: z.string().optional(),
  tickerIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v == null ? undefined : Array.isArray(v) ? v : [v])),
});

function startNdjsonStream(res: import("express").Response) {
  res.contentType("application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
}

export function makeStocksRouter({
  stocksService,
  stockCache,
  tickerStockRepo,
  getCompanyPeers,
  searchTickers,
}: {
  stocksService: StocksService;
  stockCache: StockCacheService;
  tickerStockRepo: TickerStockRepo;
  getCompanyPeers: (ticker: string) => Promise<string[]>;
  searchTickers: (query: string) => Promise<StockRoot[]>;
}) {
  const router = Router();

  // GET /api/tickers — Stage 1: stream stock info
  router.get("/", async (req, res): Promise<void> => {
    const parsed = zTickersQuery.safeParse(req.query);
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

    startNdjsonStream(res);

    const input: Parameters<typeof stocksService.streamStocks>[0] = q
      ? { q }
      : { tickerIds: tickerIds! };

    try {
      for await (const chunk of stocksService.streamStocks(input)) {
        res.write(JSON.stringify(chunk) + "\n");
      }
      res.end();
    } catch (e) {
      console.error("Tickers stock stream error:", e);
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

  // GET /api/tickers/:tickerId/peers
  router.get("/:tickerId/peers", async (req, res): Promise<void> => {
    const parsed = zGetApiTickersByTickerIdPeersPath.safeParse(req.params);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid tickerId", code: "VALIDATION_FAILED" });
      return;
    }
    const ticker = parsed.data.tickerId.toUpperCase().trim();

    let peers: string[];
    try {
      peers =
        (await stockCache.getPeersCache(ticker)) ??
        (await getCompanyPeers(ticker));
      await stockCache.setPeersCache(ticker, peers);
    } catch (e) {
      console.error(`Peers lookup error for ${ticker}:`, e);
      res.status(503).json({
        error: "Peer lookup unavailable",
        code: "UPSTREAM_UNAVAILABLE",
      });
      return;
    }

    res.contentType("application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    try {
      const enrichPromises = peers.map(async (t): Promise<StockRoot | null> => {
        try {
          const stock = await tickerStockRepo.getTickerStock(t);
          if (!stock) {
            const stocks = await searchTickers(t);
            const exact = stocks.find((s) => s.ticker.toUpperCase() === t);
            if (exact) {
              void tickerStockRepo.upsertTickerStock(exact);
              return exact;
            }
          }
          return stock ?? { ticker: t, name: t };
        } catch (e) {
          console.error(`Error enriching peer ${t}:`, e);
          return null;
        }
      });

      for await (const stock of yieldAsResolved(enrichPromises)) {
        if (stock) res.write(JSON.stringify(stock) + "\n");
      }
      res.end();
    } catch (e) {
      console.error(`Peers stream error for ${ticker}:`, e);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Internal server error", code: "INTERNAL" });
      } else {
        res.end();
      }
    }
  });

  return router;
}
