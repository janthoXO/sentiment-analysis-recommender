import type { StockRoot } from "../generated/in/index.js";
import type { TickerStockRepo } from "./ticker-stock.repo.js";
import type { StockCacheService } from "./stock.cache.js";
import { sanitizeError, errorCode } from "../middleware/httpError.js";
import {
  enrichStockProfile,
  enrichStocksProfiles,
} from "./stocks.api.js";

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
    const qUpper = q.toUpperCase().trim();

    const directHit = await tickerStockRepo.getTickerStock(qUpper);
    if (directHit) {
      console.debug(`Direct ticker cache hit for ${qUpper}`);
      const stock = await enrichStockProfile(directHit);
      yield stock;
      return;
    }

    let stocks = await stockCache.getQueryStockCache(q);
    if (stocks !== null) {
      console.debug(`Query cache hit for "${q}" (${stocks.length} tickers)`);
      stocks = await enrichStocksProfiles(stocks);
      await tickerStockRepo.upsertManyTickerStocks(stocks);
    } else {
      try {
        stocks = await searchTickers(q);
      } catch (e) {
        console.error(`Ticker search failed for "${q}":`, e);
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
      stocks = await enrichStocksProfiles(stocks);
      await tickerStockRepo.upsertManyTickerStocks(stocks);
      const isDirectTickerQuery =
        stocks.length === 1 && stocks[0]!.ticker.toUpperCase() === qUpper;
      if (!isDirectTickerQuery) {
        await stockCache.setQueryStockCache(q, stocks);
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

    let stocks: StockRoot[] = upper.map(
      (ticker) => stockMap.get(ticker) ?? { ticker, name: ticker }
    );
    stocks = await enrichStocksProfiles(stocks);

    for (const stock of stocks) {
      yield stock;
    }
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
