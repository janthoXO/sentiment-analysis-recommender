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
import { getCompanyPeers, searchTickers } from "@/stocks/stocks.api.js";
import { getPeersCache, setPeersCache } from "./stock.cache.js";
import { getTickerStock, upsertTickerStock } from "./ticker-stock.repo.js";
import type { StockRoot } from "@/generated/in/index.js";
import { getTrackersByPriority } from "@/01tracker/tracker.repo.js";

const tickersRouter = Router();

tickersRouter.get(
  "/sentiment",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = zGetApiTickersSentimentQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid query parameters",
          details: parsed.error.issues,
        });
        return;
      }

      const { q, tickerIds } = parsed.data;

      if (!q && (!tickerIds || tickerIds.length === 0)) {
        res
          .status(400)
          .json({ error: "Either q or tickerIds must be provided" });
        return;
      }

      res.contentType("application/x-ndjson");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");

      const input: Parameters<typeof streamSentiment>[0] = q
        ? { q }
        : { tickerIds: tickerIds! };

      for await (const chunk of streamSentiment(input)) {
        res.write(JSON.stringify(chunk) + "\n");
      }

      res.end();
    } catch (e) {
      console.error("Tickers sentiment router error:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error" });
      } else {
        res.write(JSON.stringify({ error: "Internal error" }) + "\n");
        res.end();
      }
    }
  }
);

tickersRouter.get(
  "/:tickerId/sentiment",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ticker = String(req.params["tickerId"] ?? "")
        .toUpperCase()
        .trim();
      if (!ticker) {
        res.status(400).json({ error: "tickerId is required" });
        return;
      }

      // Query params arrive as strings; coerce numeric fields before Zod validation.
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
        res.status(400).json({
          error: "Invalid query parameters",
          details: parsed.error.issues,
        });
        return;
      }

      const { eventTSec, intervalSec } = parsed.data;
      const stock: StockRoot = (await getTickerStock(ticker)) ?? {
        ticker,
        name: ticker,
      };

      res.contentType("application/x-ndjson");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");

      if (eventTSec?.length) {
        const promises = eventTSec.map((t) =>
          analyzeStock({ stock, eventTSec: t, intervalSec, priority: 3 }).catch(
            (e) => {
              console.error(`Error analyzing ${ticker} at event ${t}:`, e);
              return null;
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
          return null;
        });
        if (result !== null) res.write(JSON.stringify(result) + "\n");
      }

      res.end();
    } catch (e) {
      console.error("Single ticker sentiment router error:", e);
      if (!res.headersSent) {
        res.status(503).json({ error: "Sentiment data unavailable" });
      } else {
        res.end();
      }
    }
  }
);

tickersRouter.get(
  "/:tickerId/peers",
  async (req: Request, res: Response): Promise<void> => {
    try {
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
                upsertTickerStock(exact);
                return exact;
              }
            }

            return stock ?? { ticker: t, name: t };
          } catch (e) {
            console.error(`Error enriching peer ${t}:`, e);
            return null;
          }
        })
      );

      res.json(enriched.filter((s) => !!s));
    } catch (e) {
      console.error("Peers router error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

tickersRouter.get(
  "/trending",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const trackers = await getTrackersByPriority(2);
      const stocks: StockRoot[] = trackers.map((t) => ({
        ticker: t.ticker,
        name: t.name,
      }));
      res.json(stocks);
    } catch (e) {
      console.error("Trending router error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

export default tickersRouter;
