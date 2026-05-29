import { pgTable, text, integer, primaryKey } from "drizzle-orm/pg-core";
import { usersSchema } from "../auth/auth.schema.js";

export const userTickerAccessSchema = pgTable(
  "user_ticker_access",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersSchema.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    lastAccessedSec: integer("last_accessed_sec").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ticker] })]
);
