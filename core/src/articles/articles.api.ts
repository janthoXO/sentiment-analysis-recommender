import { env } from "@/env.js";
import type { SourceRoot } from "@/generated/in/index.js";
import { format, getUnixTime, subDays } from "date-fns";
import z from "zod";

const MIN_ARTICLES = 5;
const TOP_X_ARTICLES = 10;

const zFinnhubNews = z.object({
  headline: z.string(),
  url: z.string(),
  summary: z.string(),
  datetime: z.number(), // unix timestamp (seconds)
});

export async function getArticlesByTickerTime(
  ticker: string,
  fromSec: number,
  toSec: number,
  limit: number,
  now: Date = new Date()
): Promise<SourceRoot[]> {
  try {
    const from = new Date(fromSec * 1000);
    const to = new Date(toSec * 1000);
    const url = new URL("https://finnhub.io/api/v1/company-news");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("from", format(from, "yyyy-MM-dd"));
    url.searchParams.set("to", format(to, "yyyy-MM-dd"));
    url.searchParams.set("token", env.FINNHUB_API_KEY);
    const response = await fetch(url);
    const data = await zFinnhubNews.array().parseAsync(await response.json());
    return data
      .map((news) => ({
        url: news.url,
        snippet: `${news.headline}\n${news.summary}`,
        scrapedAtSec: getUnixTime(now),
        updatedAtSec: news.datetime,
      }))
      .slice(0, limit);
  } catch (e) {
    console.error(`Failed to fetch articles for ${ticker}:`);
    throw e;
  }
}

export interface GetArticlesOptions {
  ticker: string;
  /** Upper bound of the article window (Unix seconds). Defaults to now. */
  toSec?: number;
  /** Lower bound of the article window. If set, performs a single fixed-window fetch. */
  fromSec?: number;
  /** Window size in seconds. Used to derive fromSec when fromSec is absent: fromSec = toSec - intervalSec. */
  intervalSec?: number;
  /** Max articles to return. Defaults to 10. */
  limit?: number;
  /** Minimum articles before stopping exponential backoff. Defaults to 5. */
  minArticles?: number;
  /** Max exponential backoff steps (each doubles the lookback). Defaults to 6 (~32 days). */
  maxBackoffSteps?: number;
}

/**
 * Unified article fetcher. Uses a fixed window when fromSec or intervalSec is given,
 * otherwise exponentially walks back from toSec until minArticles is reached.
 */
export async function getArticles(opts: GetArticlesOptions): Promise<SourceRoot[]> {
  const {
    ticker,
    fromSec,
    intervalSec,
    limit = TOP_X_ARTICLES,
    minArticles = MIN_ARTICLES,
    maxBackoffSteps = 6,
  } = opts;
  const now = new Date();
  const toSec = opts.toSec ?? getUnixTime(now);

  // Fixed window: either fromSec is explicit, or derivable from intervalSec.
  if (fromSec !== undefined) {
    return getArticlesByTickerTime(ticker, fromSec, toSec, limit, now);
  }
  if (intervalSec !== undefined) {
    return getArticlesByTickerTime(ticker, toSec - intervalSec, toSec, limit, now);
  }

  // Exponential walk-back from toSec.
  const stepNow = new Date(toSec * 1000);
  let articles: SourceRoot[] = [];
  for (let i = 0; articles.length < minArticles && i < maxBackoffSteps; i++) {
    articles = await getArticlesByTickerTime(
      ticker,
      getUnixTime(subDays(new Date(toSec * 1000), 2 ** i)),
      toSec,
      limit,
      stepNow
    );
  }
  return articles;
}
