import { pgTable, text, integer, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersSchema } from "../auth/auth.schema.js";

export const listsSchema = pgTable("lists", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersSchema.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  createdAtSec: integer("created_at_sec").notNull(),
});

export const listItemsSchema = pgTable("list_items", {
  listId: text("list_id").notNull().references(() => listsSchema.id, { onDelete: 'cascade' }),
  ticker: text("ticker").notNull(),
}, (t) => [
  primaryKey({ columns: [t.listId, t.ticker] }),
]);

export const listsRelations = relations(listsSchema, ({ many }) => ({
  items: many(listItemsSchema),
}));

export const listItemsRelations = relations(listItemsSchema, ({ one }) => ({
  list: one(listsSchema, { fields: [listItemsSchema.listId], references: [listsSchema.id] }),
}));
