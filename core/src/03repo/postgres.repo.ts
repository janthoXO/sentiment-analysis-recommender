import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.js";
import * as schema from "./postgres.schema.js";
import { eq } from "drizzle-orm";

const pool = new pg.Pool({ connectionString: env.DB_URL });
export const db = drizzle(pool, { schema });

export async function getStock(ticker: string) {
  const res = await db
    .select()
    .from(schema.stocks)
    .where(eq(schema.stocks.ticker, ticker))
    .limit(1);
  return res[0] || null;
}

export async function saveStock(stock: {
  ticker: string;
  figi: string;
  name?: string | null;
}) {
  await db.insert(schema.stocks).values(stock).onConflictDoNothing();
}
