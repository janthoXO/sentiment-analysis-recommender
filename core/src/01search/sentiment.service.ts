import type {
  SourceRoot,
  StockRoot,
  TickerResultRoot,
} from "@/generated/in/index.js";
import * as analyzeService from "@/02analyzer/analyzer.service.js";
import {
  countFreshSourceScoresForTicker,
  listFreshSourceScoresForTicker,
} from "@/02analyzer/source-score.repo.js";
import { calculateAverageScore } from "@/02analyzer/score.util.js";
import { getArticles } from "@/articles/articles.api.js";
import {
  getEventArticlesCache,
  setEventArticlesCache,
} from "@/01trends/event-articles.cache.js";
import {
  getQueryStockCache,
  setQueryStockCache,
  getTickerArticlesCache,
  setTickerArticlesCache,
} from "./stock.cache.js";
import {
  getTickerStock,
  getManyTickerStocks,
  upsertManyTickerStocks,
} from "./ticker-stock.repo.js";
import {
  isExplicitTickerQuery,
  resolveThemeQueryStocks,
} from "./theme-query.service.js";
import { searchTickers } from "@/stocks/stocks.api.js";
import { env } from "@/env.js";
import { sanitizeError, errorCode } from "@/middleware/httpError.js";

// ---------------------------------------------------------------------------
// Core per-stock analysis
// ---------------------------------------------------------------------------

export interface AnalyzeStockOptions {
  stock: StockRoot;
  eventTSec?: number;
  intervalSec?: number;
  priority?: number;
}

async function fetchArticlesWithCache(opts: {
  ticker: string;
  eventTSec?: number;
  intervalSec?: number;
}): Promise<SourceRoot[]> {
  const { ticker, eventTSec, intervalSec } = opts;

  if (eventTSec !== undefined) {
    const cacheInterval = intervalSec ?? 0;
    let articles = await getEventArticlesCache(
      ticker,
      eventTSec,
      cacheInterval
    );
    if (articles === null) {
      articles = await getArticles({ ticker, toSec: eventTSec, intervalSec });
      await setEventArticlesCache(ticker, eventTSec, cacheInterval, articles);
    }
    return articles;
  }

  let articles = await getTickerArticlesCache(ticker);
  if (articles === null) {
    articles = await getArticles({ ticker, intervalSec });
    if (articles.length > 0) {
      await setTickerArticlesCache(ticker, articles);
    }
  } else {
    console.debug(
      `Article cache hit for ${ticker} (${articles.length} sources)`
    );
  }
  return articles;
}

export async function analyzeStock(
  opts: AnalyzeStockOptions
): Promise<TickerResultRoot | null> {
  const { stock, eventTSec, intervalSec, priority = 4 } = opts;

  const count = await countFreshSourceScoresForTicker(stock.ticker, {
    toSec: eventTSec,
    intervalSec,
  });
  if (count >= env.CACHE_MIN_SOURCES) {
    console.debug(
      `Source score cache sufficient for ${stock.ticker} (${count} entries)`
    );
    const sources = await listFreshSourceScoresForTicker(stock.ticker, {
      toSec: eventTSec,
      intervalSec,
    });
    return tag(eventTSec, {
      stock,
      sources,
      avgScore: calculateAverageScore(sources),
    });
  }

  const articles = await fetchArticlesWithCache({
    ticker: stock.ticker,
    eventTSec,
    intervalSec,
  });
  if (articles.length === 0) return null;

  const result = await analyzeService.analyzeArticles(
    stock,
    articles,
    priority
  );
  if (result === null) {
    throw new Error(`Analysis failed for ${stock.ticker}`);
  }

  return tag(eventTSec, { ...result, stock });
}

function tag(
  eventTSec: number | undefined,
  tr: TickerResultRoot
): TickerResultRoot {
  if (eventTSec === undefined) return tr;
  return { ...tr, eventTSec };
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

export async function* yieldAsResolved<T>(
  promises: Promise<T>[]
): AsyncGenerator<T> {
  const pending = new Map<number, Promise<{ index: number; value: T }>>();
  promises.forEach((p, i) => {
    pending.set(
      i,
      p.then((value) => ({ index: i, value }))
    );
  });
  while (pending.size > 0) {
    const { index, value } = await Promise.race(pending.values());
    pending.delete(index);
    yield value;
  }
}

export interface StreamError {
  error: string;
  code: string;
  ticker?: string;
}

function makeStockError(stock: StockRoot, e: unknown): StreamError {
  return {
    error: sanitizeError(e, "Analysis failed"),
    code: errorCode(e),
    ticker: stock.ticker,
  };
}

async function* analyzeStocks(
  stocks: StockRoot[]
): AsyncGenerator<TickerResultRoot | StreamError> {
  const promises = stocks.map((stock) =>
    analyzeStock({ stock, priority: 4 })
      .then((result) => {
        if (result === null) {
          return {
            error: "No articles found for this ticker",
            code: "NO_ARTICLES",
            ticker: stock.ticker,
          } satisfies StreamError;
        }
        return result;
      })
      .catch((e) => {
        console.error(`Error processing ${stock.ticker}:`, e);
        return makeStockError(stock, e);
      })
  );
  for await (const result of yieldAsResolved(promises)) {
    yield result;
  }
}

// ---------------------------------------------------------------------------
// Batch / search stream
// ---------------------------------------------------------------------------

export async function* streamSentiment(
  input: { q: string } | { tickerIds: string[] }
): AsyncGenerator<TickerResultRoot | StreamError> {
  if ("q" in input) {
    yield* streamByQuery(input.q);
  } else {
    yield* streamByTickerIds(input.tickerIds);
  }
}

async function* streamByQuery(
  q: string
): AsyncGenerator<TickerResultRoot | StreamError> {
  const qTrim = q.trim();
  const qUpper = qTrim.toUpperCase();

  if (isExplicitTickerQuery(qTrim)) {
    const directHit = await getTickerStock(qUpper);
    if (directHit) {
      console.debug(`Direct ticker cache hit for ${qUpper}`);
      try {
        const result = await analyzeStock({ stock: directHit, priority: 4 });
        if (result) {
          yield result;
        } else {
          yield {
            error: "No articles found for this ticker",
            code: "NO_ARTICLES",
            ticker: qUpper,
          } satisfies StreamError;
        }
      } catch (e) {
        console.error(`Error processing direct ticker ${qUpper}:`, e);
        yield makeStockError(directHit, e);
      }
      return;
    }
  }

  let usedThemeResolver = false;
  let stocks = await getQueryStockCache(qTrim);
  if (stocks !== null) {
    console.debug(`Query cache hit for "${qTrim}" (${stocks.length} tickers)`);
  } else {
    try {
      const themeStocks = isExplicitTickerQuery(qTrim)
        ? null
        : await resolveThemeQueryStocks(qTrim);
      if (themeStocks) {
        stocks = themeStocks;
        usedThemeResolver = true;
        console.debug(
          `LLM theme query resolved "${qTrim}" to ${stocks.length} tickers`
        );
      } else {
        stocks = await searchTickers(qTrim);
      }
    } catch (e) {
      console.error(`Ticker search failed for "${qTrim}":`, e);
      yield {
        error: sanitizeError(e, "Ticker search failed"),
        code: errorCode(e),
      } satisfies StreamError;
      return;
    }
    if (stocks.length === 0) {
      yield {
        error: "No tickers found",
        code: "NO_TICKERS",
      } satisfies StreamError;
      return;
    }
    await upsertManyTickerStocks(stocks);
    const isDirectTickerQuery =
      stocks.length === 1 && stocks[0]!.ticker.toUpperCase() === qUpper;
    if (usedThemeResolver || !isDirectTickerQuery) {
      await setQueryStockCache(qTrim, stocks);
    }
  }

  yield* analyzeStocks(stocks);
}

async function* streamByTickerIds(
  tickerIds: string[]
): AsyncGenerator<TickerResultRoot | StreamError> {
  if (tickerIds.length === 0) {
    yield {
      error: "No ticker IDs provided",
      code: "NO_TICKERS",
    } satisfies StreamError;
    return;
  }

  const upper = tickerIds.map((t) => t.toUpperCase().trim()).filter(Boolean);
  const stockMap = await getManyTickerStocks(upper);

  const stocks: StockRoot[] = upper.map(
    (ticker) => stockMap.get(ticker) ?? { ticker, name: ticker }
  );

  yield* analyzeStocks(stocks);
}
