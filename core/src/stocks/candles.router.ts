import { Router } from "express";
import type { CandleDuration } from "./candles.api.js";
import { fetchCandlesByWindow } from "./candles.api.js";
import type { CandlesCacheService } from "./candles.cache.js";
import { zGetApiTickersByTickerIdCandlesQuery } from "../generated/in/zod.gen.js";
import { getUnixTime } from "date-fns";
import { asyncHandler, HttpError } from "../middleware/httpError.js";

const DURATION_TO_SEC: Record<CandleDuration, number | null> = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "1Y": 365 * 86_400,
  today: null,
};

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

      const toSec = getUnixTime(new Date());
      const durSec = DURATION_TO_SEC[duration];
      const fromSec =
        durSec !== null ? toSec - durSec : Math.floor(toSec / 86_400) * 86_400;

      const cached = await candlesCache.getCandlesCache(
        ticker,
        duration,
        interval
      );
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
      await candlesCache.setCandlesCache(ticker, duration, interval, series);
      res.json(series);
    })
  );

  return router;
}
