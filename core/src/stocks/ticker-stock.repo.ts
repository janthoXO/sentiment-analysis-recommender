import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { tickerStockSchema } from "./ticker-stock.schema.js";
import type { StockRoot } from "../generated/in/index.js";
import { env } from "@/env.js";

type TickerStockRow = typeof tickerStockSchema.$inferSelect;

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
      return row ? rowToStock(row as TickerStockRow) : null;
    },

    async upsertTickerStock(stock) {
      await db
        .insert(tickerStockSchema)
        .values(stock)
        .onConflictDoUpdate({
          target: tickerStockSchema.ticker,
          set: {
            name: stock.name,
            sector: stock.sector ?? null,
            industry: stock.industry ?? null,
            exchange: stock.exchange ?? null,
          },
        });
    },

    async upsertManyTickerStocks(stocks) {
      if (stocks.length === 0) return;
      await db
        .insert(tickerStockSchema)
        .values(stocks)
        .onConflictDoUpdate({
          target: tickerStockSchema.ticker,
          set: {
            name: sql`excluded.name`,
            sector: sql`excluded.sector`,
            industry: sql`excluded.industry`,
            exchange: sql`excluded.exchange`,
          },
        });
    },

    async getManyTickerStocks(tickers) {
      if (tickers.length === 0) return new Map();
      const rows = await db
        .select()
        .from(tickerStockSchema)
        .where(inArray(tickerStockSchema.ticker, tickers));
      return new Map(rows.map((r) => [r.ticker, rowToStock(r)]));
    },

    async getTrendingStocks() {
      const rows = await db
        .select()
        .from(tickerStockSchema)
        .where(
          sql`${tickerStockSchema.ticker} IN (SELECT DISTINCT ticker FROM tracker WHERE priority = ${env.TRENDING_PRIORITY})`
        );
      return rows.map(rowToStock);
    },
  };
}

function rowToStock(row: TickerStockRow): StockRoot {
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector ?? undefined,
    industry: row.industry ?? undefined,
    exchange: row.exchange ?? undefined,
  };
}
