import { zRoot, zStockRoot } from "@/generated/in/zod.gen.js";
import { getRedis } from "@/cache.repo.js";
import type { Root, StockRoot } from "@/generated/in/index.js";
import { env } from "@/env.js";

const queryStockKey = (query: string) => `query-stock:${query}`;
const tickerArticlesKey = (ticker: string) => `ticker-articles:${ticker}`;

export async function getQueryStockCache(query: string): Promise<StockRoot[] | null> {
  const data = await getRedis().get(queryStockKey(query));
  return data ? zStockRoot.array().parse(JSON.parse(data)) : null;
}

export async function setQueryStockCache(query: string, stocks: StockRoot[]): Promise<void> {
  await getRedis().set(queryStockKey(query), JSON.stringify(stocks), "EX", env.CACHE_TTL_QUERY_SEC);
}

export async function getTickerArticlesCache(ticker: string): Promise<Root[] | null> {
  const data = await getRedis().get(tickerArticlesKey(ticker));
  return data ? zRoot.array().parse(JSON.parse(data)) : null;
}

export async function setTickerArticlesCache(ticker: string, articles: Root[]): Promise<void> {
  await getRedis().set(tickerArticlesKey(ticker), JSON.stringify(articles), "EX", env.CACHE_TTL_ARTICLES_SEC);
}
