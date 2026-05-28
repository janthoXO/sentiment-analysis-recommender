import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { tickerStockSchema } from "./ticker-stock.schema.js";
import type { StockRoot } from "../generated/in/index.js";

export interface TickerStockRepo {
  getTickerStock(ticker: string): Promise<StockRoot | null>;
  upsertTickerStock(stock: StockRoot): Promise<void>;
  upsertManyTickerStocks(stocks: StockRoot[]): Promise<void>;
  getManyTickerStocks(tickers: string[]): Promise<Map<string, StockRoot>>;
  getTrendingStocks(): Promise<StockRoot[]>;
}

export function makeTickerStockRepo(db: Db): TickerStockRepo {
  return {
    async getTickerStock(ticker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (db as any).query.tickerStockSchema.findFirst({
        where: eq(tickerStockSchema.ticker, ticker),
      });
      return (row as StockRoot | undefined) ?? null;
    },

    async upsertTickerStock(stock) {
      await db
        .insert(tickerStockSchema)
        .values(stock)
        .onConflictDoUpdate({
          target: tickerStockSchema.ticker,
          set: { name: stock.name },
        });
    },

    async upsertManyTickerStocks(stocks) {
      if (stocks.length === 0) return;
      await db
        .insert(tickerStockSchema)
        .values(stocks)
        .onConflictDoUpdate({
          target: tickerStockSchema.ticker,
          set: { name: sql`excluded.name` },
        });
    },

    async getManyTickerStocks(tickers) {
      if (tickers.length === 0) return new Map();
      const rows = await db
        .select()
        .from(tickerStockSchema)
        .where(inArray(tickerStockSchema.ticker, tickers));
      return new Map((rows as StockRoot[]).map((r) => [r.ticker, r]));
    },

    async getTrendingStocks() {
      const rows = await db
        .select()
        .from(tickerStockSchema)
        .where(
          sql`${tickerStockSchema.ticker} IN (SELECT DISTINCT ticker FROM tracker WHERE priority = 2)`
        );
      return rows as StockRoot[];
    },
  };
}
