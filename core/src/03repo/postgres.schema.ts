import { pgTable, text } from "drizzle-orm/pg-core";

export const stocks = pgTable("stocks", {
  ticker: text("ticker").primaryKey(),
  figi: text("figi").notNull(),
  name: text("name"),
});
