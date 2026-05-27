import { pgTable, text } from "drizzle-orm/pg-core";

export const usersSchema = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});
