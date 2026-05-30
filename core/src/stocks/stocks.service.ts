import type { StockRoot } from "../generated/in/index.js";
import type { TickerStockRepo } from "./ticker-stock.repo.js";
import type { StockCacheService } from "./stock.cache.js";
import { sanitizeError, errorCode } from "../middleware/httpError.js";
import {
  isExplicitTickerQuery,
  resolveThemeQueryStocks,
} from "./theme-query.service.js";
import { dedupe } from "../utils/dedupe.js";

export interface StreamError {
  error: string;
  code: string;
  ticker?: string;
}

export interface StocksService {
  streamStocks(
    input: { q: string } | { tickerIds: string[] }
  ): AsyncGenerator<StockRoot | StreamError>;
}

export function makeStocksService({
  tickerStockRepo,
  stockCache,
  searchTickers,
}: {
  tickerStockRepo: TickerStockRepo;
  stockCache: StockCacheService;
  searchTickers: (query: string) => Promise<StockRoot[]>;
}): StocksService {
  async function* streamStocksByQuery(
    q: string
  ): AsyncGenerator<StockRoot | StreamError> {
    const qTrim = q.trim();
    const qUpper = qTrim.toUpperCase();
    const isExplicitQuery = isExplicitTickerQuery(qTrim);

    if (isExplicitQuery) {
      const directHit = await tickerStockRepo.getTickerStock(qUpper);
      if (directHit) {
        console.debug(`Direct ticker cache hit for ${qUpper}`);
        yield directHit;
        return;
      }
    }

    let usedThemeResolver = false;
    const cacheKeys = getQueryCacheKeys(qTrim, isExplicitQuery);
    let stocks: StockRoot[] | null = null;

    for (const cacheKey of cacheKeys) {
      stocks = await stockCache.getQueryStockCache(cacheKey);
      if (stocks !== null) {
        console.debug(
          `Query cache hit for "${cacheKey}" (${stocks.length} tickers)`
        );
        break;
      }
    }

    if (stocks === null) {
      try {
        const themeStocks = isExplicitQuery
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
      await tickerStockRepo.upsertManyTickerStocks(stocks);
      const isDirectTickerQuery =
        stocks.length === 1 && stocks[0]!.ticker.toUpperCase() === qUpper;
      if (usedThemeResolver || !isDirectTickerQuery) {
        const stocksToCache = stocks;
        await Promise.all(
          cacheKeys.map((cacheKey) =>
            stockCache.setQueryStockCache(cacheKey, stocksToCache)
          )
        );
      }
    }

    for (const stock of stocks) {
      yield stock;
    }
  }

  async function* streamStocksByTickerIds(
    tickerIds: string[]
  ): AsyncGenerator<StockRoot | StreamError> {
    if (tickerIds.length === 0) {
      yield {
        error: "No ticker IDs provided",
        code: "NO_TICKERS",
      } satisfies StreamError;
      return;
    }

    const upper = tickerIds.map((t) => t.toUpperCase().trim()).filter(Boolean);
    const stockMap = await tickerStockRepo.getManyTickerStocks(upper);

    for (const ticker of upper) {
      yield stockMap.get(ticker) ?? { ticker, name: ticker };
    }
  }

  function getQueryCacheKeys(
    query: string,
    isExplicitQuery: boolean
  ): string[] {
    if (isExplicitQuery) return [query];

    const normalized = normalizeThemeQueryCacheKey(query);
    return dedupe(
      [query, normalized, toTitleCase(normalized)].filter(Boolean),
      (cacheKey) => cacheKey
    );
  }

  function normalizeThemeQueryCacheKey(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function toTitleCase(query: string): string {
    return query
      .split(" ")
      .map((word) =>
        word.length === 0
          ? word
          : word[0]!.toUpperCase() + word.slice(1).toLowerCase()
      )
      .join(" ");
  }

  return {
    async *streamStocks(input) {
      if ("q" in input) {
        yield* streamStocksByQuery(input.q);
      } else {
        yield* streamStocksByTickerIds(input.tickerIds);
      }
    },
  };
}
