import { Router } from "express";
import { fetchCandles } from "./candles.api.js";
import type { CandlesCacheService } from "./candles.cache.js";
import { zGetApiTickersByTickerIdCandlesQuery } from "../generated/in/zod.gen.js";
import { asyncHandler, HttpError } from "../middleware/httpError.js";

export function makeCandlesRouter({
  candlesCache,
}: {
  candlesCache: CandlesCacheService;
}) {
  const router = Router();

  router.get(
    "/:tickerId/candles",
    asyncHandler(async (req, res) => {
      const ticker = String(req.params["tickerId"] ?? "")
        .toUpperCase()
        .trim();
      if (!ticker) {
        throw HttpError.badRequest("MISSING_TICKER", "tickerId is required");
      }

      const parsed = zGetApiTickersByTickerIdCandlesQuery.safeParse(req.query);
      if (!parsed.success) {
        throw HttpError.badRequest(
          "VALIDATION_FAILED",
          "Invalid query parameters"
        );
      }
      const { duration, interval } = parsed.data;

      const cached = await candlesCache.getCandlesCache(
        ticker,
        duration,
        interval
      );
      if (cached) {
        res.json(cached);
        return;
      }

      const series = await fetchCandles(ticker, duration, interval);
      await candlesCache.setCandlesCache(ticker, duration, interval, series);
      res.json(series);
    })
  );

  return router;
}
