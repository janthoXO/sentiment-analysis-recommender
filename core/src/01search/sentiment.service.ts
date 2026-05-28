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
import { searchTickers } from "@/stocks/stocks.api.js";
import { env } from "@/env.js";

// ---------------------------------------------------------------------------
// Core per-stock analysis
// ---------------------------------------------------------------------------

export interface AnalyzeStockOptions {
  stock: StockRoot;
  /** When set, pins the article window and tags the result. */
  eventTSec?: number;
  /** Article-window size in seconds. */
  intervalSec?: number;
  /** Analysis priority passed to the analyzer queue. Default 4. */
  priority?: number;
}

async function fetchArticlesWithCache(opts: {
  ticker: string;
  eventTSec?: number;
  intervalSec?: number;
}): Promise<SourceRoot[]> {
  const { ticker, eventTSec, intervalSec } = opts;

  if (eventTSec !== undefined) {
    // event-articles cache; use 0 as the interval sentinel for backoff-mode
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

  // Non-event: standard ticker-articles cache
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

  // DB short-circuit: enough fresh scores already stored?
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

/** Yields resolved values from an array of promises in completion order. */
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

async function* analyzeStocks(
  stocks: StockRoot[]
): AsyncGenerator<TickerResultRoot> {
  const promises = stocks.map((stock) =>
    analyzeStock({ stock, priority: 4 }).catch((e) => {
      console.error(`Error processing ${stock.ticker}:`, e);
      return null;
    })
  );
  for await (const result of yieldAsResolved(promises)) {
    if (result !== null) yield result;
  }
}

// ---------------------------------------------------------------------------
// Batch / search stream
// ---------------------------------------------------------------------------

export async function* streamSentiment(
  input: { q: string } | { tickerIds: string[] }
): AsyncGenerator<TickerResultRoot | { error: string }> {
  if ("q" in input) {
    yield* streamByQuery(input.q);
  } else {
    yield* streamByTickerIds(input.tickerIds);
  }
}

async function* streamByQuery(
  q: string
): AsyncGenerator<TickerResultRoot | { error: string }> {
  const qUpper = q.toUpperCase().trim();

  // Direct ticker lookup
  const directHit = await getTickerStock(qUpper);
  if (directHit) {
    console.debug(`Direct ticker cache hit for ${qUpper}`);
    try {
      const result = await analyzeStock({ stock: directHit, priority: 4 });
      if (result) yield result;
    } catch (e) {
      console.error(`Error processing direct ticker ${qUpper}:`, e);
    }
    return;
  }

  // Query cache → Finnhub search
  let stocks = await getQueryStockCache(q);
  if (stocks !== null) {
    console.debug(`Query cache hit for "${q}" (${stocks.length} tickers)`);
  } else {
    stocks = await searchTickers(q);
    if (stocks.length === 0) {
      yield { error: "No tickers found" };
      return;
    }
    await upsertManyTickerStocks(stocks);
    const isDirectTickerQuery =
      stocks.length === 1 && stocks[0]!.ticker.toUpperCase() === qUpper;
    if (!isDirectTickerQuery) {
      await setQueryStockCache(q, stocks);
    }
  }

  yield* analyzeStocks(stocks);
}

async function* streamByTickerIds(
  tickerIds: string[]
): AsyncGenerator<TickerResultRoot | { error: string }> {
  if (tickerIds.length === 0) {
    yield { error: "No ticker IDs provided" };
    return;
  }

  const upper = tickerIds.map((t) => t.toUpperCase().trim()).filter(Boolean);
  const stockMap = await getManyTickerStocks(upper);

  const stocks: StockRoot[] = upper.map(
    (ticker) => stockMap.get(ticker) ?? { ticker, name: ticker }
  );

  yield* analyzeStocks(stocks);
}
