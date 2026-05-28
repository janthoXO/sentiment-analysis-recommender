import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../postgres.repo.js";
import { tickerStockSchema } from "./ticker-stock.schema.js";
import type { StockRoot } from "@/generated/in/index.js";

type TickerStockRow = typeof tickerStockSchema.$inferSelect;

export async function getTickerStock(
  ticker: string
): Promise<StockRoot | null> {
  const row = await db.query.tickerStockSchema.findFirst({
    where: eq(tickerStockSchema.ticker, ticker),
  });
  return row ? rowToStock(row) : null;
}

export async function upsertTickerStock(stock: StockRoot): Promise<void> {
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
}

export async function upsertManyTickerStocks(
  stocks: StockRoot[]
): Promise<void> {
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
}

export async function getManyTickerStocks(
  tickers: string[]
): Promise<Map<string, StockRoot>> {
  if (tickers.length === 0) return new Map();
  const rows = await db
    .select()
    .from(tickerStockSchema)
    .where(inArray(tickerStockSchema.ticker, tickers));
  return new Map(rows.map((r) => [r.ticker, rowToStock(r)]));
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
