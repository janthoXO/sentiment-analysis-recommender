import { zStockRoot } from "@/generated/in/zod.gen.js";
import { getRedis } from "@/cache.repo.js";
import type { StockRoot } from "@/generated/in/index.js";

const queryStockCache = (query: string) => `query-stock:${query}`;

export async function getQueryStockCache(
  query: string
): Promise<StockRoot[] | null> {
  const key = queryStockCache(query);
  const data = await getRedis().get(key);
  return data ? zStockRoot.array().parse(JSON.parse(data)) : null;
}

/**
 * Sets the stock cache for a given query.
 * Only updates the cache if the new stock data is more recent than the existing cached data.
 */
export async function setQueryStockCache(
  query: string,
  stockData: StockRoot[]
) {
  const key = queryStockCache(query);
  await getRedis().set(key, JSON.stringify(stockData));
}
