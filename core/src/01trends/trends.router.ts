import { Router } from "express";
import type { Request, Response } from "express";
import type { CandleDuration } from "./trends.api.js";
import { fetchCandlesByWindow } from "./trends.api.js";
import { getCandlesCache, setCandlesCache } from "./trends.cache.js";
import { zGetApiTickersByTickerIdCandlesQuery } from "@/generated/in/zod.gen.js";
import { getUnixTime } from "date-fns";

const DURATION_TO_SEC: Record<CandleDuration, number | null> = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "1Y": 365 * 86_400,
  today: null,
};

const trendsRouter = Router();

trendsRouter.get(
  "/:tickerId/candles",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ticker = String(req.params["tickerId"] ?? "")
        .toUpperCase()
        .trim();
      if (!ticker) {
        res.status(400).json({ error: "tickerId is required" });
        return;
      }

      const parsed = zGetApiTickersByTickerIdCandlesQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid query parameters",
          details: parsed.error.issues,
        });
        return;
      }
      const { duration, interval } = parsed.data;

      const toSec = getUnixTime(new Date());
      const durSec = DURATION_TO_SEC[duration];
      const fromSec =
        durSec !== null ? toSec - durSec : Math.floor(toSec / 86_400) * 86_400;

      const cached = await getCandlesCache(ticker, duration, interval);
      if (cached) {
        res.json(cached);
        return;
      }

      const series = await fetchCandlesByWindow(
        ticker,
        fromSec,
        toSec,
        interval
      );
      await setCandlesCache(ticker, duration, interval, series);
      res.json(series);
    } catch (e) {
      console.error("Candles router error:", e);
      res.status(503).json({ error: "Price data unavailable" });
    }
  }
);

export default trendsRouter;
