import YahooFinance from "yahoo-finance2";
import z from "zod";
import { zRoot, zCandleSeries } from "../generated/in/zod.gen.js";
import { fromUnixTime, getUnixTime, startOfDay, subDays } from "date-fns";
import { HttpError } from "../middleware/httpError.js";

const yf = new YahooFinance();

export type CandleInterval = "5m" | "30m" | "1d";
export type CandleDuration = "1D" | "1W" | "1M" | "1Y" | "today";
export type Candle = z.infer<typeof zRoot>;
export type CandleSeries = z.infer<typeof zCandleSeries>;

// Duration in seconds for non-"today" ranges.
const DURATION_TO_SEC: Partial<Record<CandleDuration, number>> = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "1Y": 365 * 86_400,
};

const zYahooQuote = z.object({
  date: z.date(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number().nullable(),
  volume: z.number().nullable(),
});

async function fetchFromYahoo(
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

/**
 * Fetch candles anchored to the last trading session rather than "now".
 *
 * A 7-day buffer before the requested window guarantees we always capture at
 * least one trading session even across long holiday weekends.  After fetching
 * we trim to the requested window relative to the anchor (= last returned
 * candle), so the caller always gets data from the most recent session.
 */
export async function fetchCandles(
  ticker: string,
  duration: CandleDuration,
  interval: CandleInterval
): Promise<CandleSeries> {
  const now = new Date();
  const durSec = DURATION_TO_SEC[duration] ?? 0;

  // Extend the lower bound by 7 days beyond the requested window so we find
  // the last trading session even on weekends and holidays.
  const period1 = subDays(now, durSec / 86_400 + 7);
  const allCandles = await fetchFromYahoo(ticker, interval, period1, now);

  if (allCandles.length === 0) {
    throw HttpError.notFound(
      "NO_PRICE_DATA",
      `No price data available for ${ticker}`
    );
  }

  // Anchor to the last returned candle — this is the close of the latest
  // trading session regardless of when the request arrives.
  const anchorTSec = allCandles.at(-1)!.tSec;

  const candles =
    duration === "today"
      ? // Latest full session: everything from midnight of the anchor's day.
        allCandles.filter(
          (c) => c.tSec >= getUnixTime(startOfDay(fromUnixTime(anchorTSec)))
        )
      : // Other durations: slide the window back from the anchor.
        allCandles.filter((c) => c.tSec >= anchorTSec - durSec);

  return zCandleSeries.parse({ ticker, interval, candles });
}
