import { env } from "@/env.js";
import type { SourceRoot } from "@/generated/in/index.js";
import * as cheerio from "cheerio";
import { format, getUnixTime, subDays } from "date-fns";
import YahooFinance from "yahoo-finance2";
import z from "zod";
import { HttpError } from "@/middleware/httpError.js";

const MIN_ARTICLES = 5;
const TOP_X_ARTICLES = 10;

const yf = new YahooFinance();

const zFinnhubNews = z.object({
  headline: z.string(),
  url: z.string(),
  summary: z.string(),
  datetime: z.number(),
});

async function scrapeArticleSnippet(
  url: string,
  fallbackTitle: string
): Promise<string> {
  try {
    const html = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
    }).then((r) => r.text());
    const $ = cheerio.load(html);
    const meta =
      $('meta[property="og:description"]').attr("content") ??
      $('meta[name="description"]').attr("content") ??
      $("article p").first().text().trim();
    return meta ? `${fallbackTitle}\n${meta}` : fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}

export async function getArticlesByTickerTime(
  ticker: string,
  fromSec: number,
  toSec: number,
  limit: number,
  now: Date = new Date()
): Promise<SourceRoot[]> {
  const from = new Date(fromSec * 1000);
  const to = new Date(toSec * 1000);
  const url = new URL("https://finnhub.io/api/v1/company-news");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("from", format(from, "yyyy-MM-dd"));
  url.searchParams.set("to", format(to, "yyyy-MM-dd"));
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw HttpError.upstreamUnavailable("News feed unavailable", e);
  }

  if (response.status === 429 || response.status >= 500) {
    throw HttpError.upstreamUnavailable(
      `News feed rate-limited or unavailable (${response.status})`
    );
  }
  if (!response.ok) {
    throw HttpError.upstreamUnavailable(
      `News feed failed (${response.status})`
    );
  }

  const data = await zFinnhubNews.array().parseAsync(await response.json());
  return data
    .map((news) => ({
      url: news.url,
      snippet: `${news.headline}\n${news.summary}`,
      scrapedAtSec: getUnixTime(now),
      updatedAtSec: news.datetime,
    }))
    .slice(0, limit);
}

async function getArticlesByTickerLatest(
  ticker: string,
  limit: number,
  now: Date
): Promise<SourceRoot[]> {
  try {
    const res = await yf.search(ticker, { newsCount: limit, quotesCount: 0 });
    return Promise.all(
      res.news.map(async (n) => ({
        url: n.link,
        snippet: await scrapeArticleSnippet(n.link, n.title),
        scrapedAtSec: getUnixTime(now),
        updatedAtSec: getUnixTime(n.providerPublishTime),
      }))
    );
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw HttpError.upstreamUnavailable("News feed unavailable", e);
  }
}

export interface GetArticlesOptions {
  ticker: string;
  toSec?: number;
  fromSec?: number;
  intervalSec?: number;
  limit?: number;
  minArticles?: number;
  maxBackoffSteps?: number;
}

/**
 * Unified article fetcher.
 *
 * Fixed window (fromSec or intervalSec given) → Finnhub only.
 * Latest news (no window) → Yahoo first; Finnhub exponential walk-back fallback.
 */
export async function getArticles(
  opts: GetArticlesOptions
): Promise<SourceRoot[]> {
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

  if (fromSec !== undefined) {
    return getArticlesByTickerTime(ticker, fromSec, toSec, limit, now);
  }
  if (intervalSec !== undefined) {
    return getArticlesByTickerTime(
      ticker,
      toSec - intervalSec,
      toSec,
      limit,
      now
    );
  }

  // Latest news: Yahoo first; Finnhub walk-back only when Yahoo returns nothing.
  let yahooArticles: SourceRoot[] = [];
  try {
    yahooArticles = await getArticlesByTickerLatest(ticker, limit, now);
  } catch {
    // Yahoo failed — fall through to Finnhub walk-back
  }
  if (yahooArticles.length > 0) {
    return yahooArticles;
  }

  // Finnhub exponential walk-back fallback.
  const stepNow = new Date(toSec * 1000);
  let articles: SourceRoot[] = [];
  for (let i = 0; articles.length < minArticles && i < maxBackoffSteps; i++) {
    try {
      articles = await getArticlesByTickerTime(
        ticker,
        getUnixTime(subDays(new Date(toSec * 1000), 2 ** i)),
        toSec,
        limit,
        stepNow
      );
    } catch {
      break;
    }
  }
  return articles;
}
