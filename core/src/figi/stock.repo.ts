import { db } from "@/postgres.repo.js";
import { stockSchema } from "@/figi/stock.schema.js";
import { eq } from "drizzle-orm";

export async function getStock(ticker: string) {
  const res = await db
    .select()
    .from(stockSchema)
    .where(eq(stockSchema.ticker, ticker))
    .limit(1);
  return res[0] || null;
}

export async function saveStock(stock: {
  ticker: string;
  figi: string;
  name?: string | null;
}) {
  await db.insert(stockSchema).values(stock).onConflictDoNothing();
}
