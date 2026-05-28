import YahooFinance from "yahoo-finance2";
import z from "zod";
import { zRoot, zCandleSeries } from "@/generated/in/zod.gen.js";
import { getUnixTime } from "date-fns";

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
  const raw = await yf.chart(ticker, { interval, period1, period2 });
  const quotes = z.array(zYahooQuote).parse(raw.quotes);

  return quotes
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
