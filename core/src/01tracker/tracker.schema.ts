import {
  pgTable,
  text,
  integer,
  bigint,
  primaryKey,
} from "drizzle-orm/pg-core";

export const trackerSchema = pgTable(
  "tracker",
  {
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }),
    interval: bigint("interval", { mode: "number" }).notNull(),
    lastTriggeredAt: bigint("last_triggered_at", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.ticker, table.priority, table.interval] }),
  ]
);
