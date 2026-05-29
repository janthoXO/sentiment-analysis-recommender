import { pgTable, text, bigint, real, primaryKey } from "drizzle-orm/pg-core";
import { tickerStockSchema } from "../stocks/ticker-stock.schema.js";

export const sourceScoreSchema = pgTable(
  "source_score",
  {
    ticker: text("ticker")
      .notNull()
      .references(() => tickerStockSchema.ticker),
    url: text("url").notNull(),
    snippet: text("snippet").notNull(),
    updatedAtSec: bigint("updated_at_sec", { mode: "number" }).notNull(),
    scrapedAtSec: bigint("scraped_at_sec", { mode: "number" }).notNull(),
    score: real("score"),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.url] })]
);
