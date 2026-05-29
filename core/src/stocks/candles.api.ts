import YahooFinance from "yahoo-finance2";
import z from "zod";
import { zRoot, zCandleSeries } from "../generated/in/zod.gen.js";
import { getUnixTime } from "date-fns";
import { HttpError } from "../middleware/httpError.js";

const yf = new YahooFinance();

export type CandleInterval = "5m" | "30m" | "1d";
export type CandleDuration = "1D" | "1W" | "1M" | "1Y" | "today";
export type Candle = z.infer<typeof zRoot>;
export type CandleSeries = z.infer<typeof zCandleSeries>;

const zYahooQuote = z.object({
  date: z.date(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number().nullable(),
  volume: z.number().nullable(),
});

async function fetchYahooQuotes(
  ticker: string,
  interval: CandleInterval,
  period1: Date,
  period2: Date
): Promise<Candle[]> {
  let rawResult: unknown;
  try {
    rawResult = await yf.chart(ticker, { interval, period1, period2 });
  } catch (e) {
    throw HttpError.upstreamUnavailable(
      `Price data unavailable for ${ticker}`,
      e
    );
  }

  const raw = rawResult as { quotes: unknown[] };
  const quotes = z.array(zYahooQuote).parse(raw.quotes);

  const candles = quotes
    .filter(
      (q) =>
        q.open != null && q.high != null && q.low != null && q.close != null
    )
    .map((q) => ({
      tSec: getUnixTime(q.date),
      open: q.open!,
      high: q.high!,
      low: q.low!,
      close: q.close!,
      volume: q.volume ?? undefined,
    }));

  if (candles.length === 0) {
    throw HttpError.notFound(
      "NO_PRICE_DATA",
      `No price data available for ${ticker} in this window`
    );
  }

  return candles;
}

export async function fetchCandlesByWindow(
  ticker: string,
  fromSec: number,
  toSec: number,
  interval: CandleInterval
): Promise<CandleSeries> {
  const candles = await fetchYahooQuotes(
    ticker,
    interval,
    new Date(fromSec * 1000),
    new Date(toSec * 1000)
  );
  return zCandleSeries.parse({ ticker, interval, candles });
}
