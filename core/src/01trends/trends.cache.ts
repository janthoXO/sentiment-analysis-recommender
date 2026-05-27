import { getRedis } from "@/cache.repo.js";
import type { CandleSeries, CandleInterval, CandleDuration } from "./trends.api.js";

const TTL = 300;

const cacheKey = (ticker: string, duration: CandleDuration, interval: CandleInterval) =>
  `candles:${ticker}:${duration}:${interval}`;

export async function getCandlesCache(
  ticker: string,
  duration: CandleDuration,
  interval: CandleInterval
): Promise<CandleSeries | null> {
  const data = await getRedis().get(cacheKey(ticker, duration, interval));
  return data ? (JSON.parse(data) as CandleSeries) : null;
}

export async function setCandlesCache(
  ticker: string,
  duration: CandleDuration,
  interval: CandleInterval,
  series: CandleSeries
): Promise<void> {
  if (series.candles.length === 0) return;
  await getRedis().set(cacheKey(ticker, duration, interval), JSON.stringify(series), "EX", TTL);
}
