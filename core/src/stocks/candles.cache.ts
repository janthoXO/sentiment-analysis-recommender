import type { RedisClient } from "../utils/cache.repo.js";
import type {
  CandleSeries,
  CandleInterval,
  CandleDuration,
} from "./candles.api.js";

const TTL = 300;

const cacheKey = (
  ticker: string,
  duration: CandleDuration,
  interval: CandleInterval
) => `candles:${ticker}:${duration}:${interval}`;

export interface CandlesCacheService {
  getCandlesCache(
    ticker: string,
    duration: CandleDuration,
    interval: CandleInterval
  ): Promise<CandleSeries | null>;
  setCandlesCache(
    ticker: string,
    duration: CandleDuration,
    interval: CandleInterval,
    series: CandleSeries
  ): Promise<void>;
}

export function makeCandlesCache(redis: RedisClient): CandlesCacheService {
  return {
    async getCandlesCache(ticker, duration, interval) {
      const data = await redis.get(cacheKey(ticker, duration, interval));
      return data ? (JSON.parse(data) as CandleSeries) : null;
    },

    async setCandlesCache(ticker, duration, interval, series) {
      if (series.candles.length === 0) return;
      await redis.set(
        cacheKey(ticker, duration, interval),
        JSON.stringify(series),
        "EX",
        TTL
      );
    },
  };
}
