import {
  pgTable,
  text,
  numeric,
  timestamp,
  uuid,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticker: text("ticker").notNull(),
    scanJobId: uuid("scan_job_id").notNull(),
    url: text("url"),
    snippet: text("snippet"),
    score: numeric("score", { precision: 4, scale: 3 }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_articles_ticker").on(table.ticker),
    index("idx_articles_scan_job_id").on(table.scanJobId),
  ]
);

export const stockScores = pgTable("stock_scores", {
  ticker: text("ticker").primaryKey(),
  avgScore: numeric("avg_score", { precision: 4, scale: 3 }),
  articleCount: integer("article_count"),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const stocks = pgTable("stocks", {
  ticker: text("ticker").primaryKey(),
  figi: text("figi").notNull().unique(),
  name: text("name"),
});
