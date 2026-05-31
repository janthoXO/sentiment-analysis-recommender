import { pgTable, text } from "drizzle-orm/pg-core";

export const tickerStockSchema = pgTable("ticker_stock", {
  ticker: text("ticker").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector"),
  industry: text("industry"),
  exchange: text("exchange"),
});
