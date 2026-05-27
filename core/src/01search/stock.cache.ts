import z from "zod";
import { zSourceRoot, zStockRoot } from "@/generated/in/zod.gen.js";
import { getRedis } from "@/cache.repo.js";
import type { SourceRoot, StockRoot } from "@/generated/in/index.js";
import { env } from "@/env.js";

const queryStockKey = (query: string) => `query-stock:${query}`;
const tickerArticlesKey = (ticker: string) => `ticker-articles:${ticker}`;

export async function getQueryStockCache(
  query: string
): Promise<StockRoot[] | null> {
  const data = await getRedis().get(queryStockKey(query));
  return data ? zStockRoot.array().parse(JSON.parse(data)) : null;
}

export async function setQueryStockCache(
  query: string,
  stocks: StockRoot[]
): Promise<void> {
  await getRedis().set(
    queryStockKey(query),
    JSON.stringify(stocks),
    "EX",
    env.CACHE_TTL_QUERY_SEC
  );
}

export async function getTickerArticlesCache(
  ticker: string
): Promise<SourceRoot[] | null> {
  const data = await getRedis().get(tickerArticlesKey(ticker));
  return data ? zSourceRoot.array().parse(JSON.parse(data)) : null;
}

export async function setTickerArticlesCache(
  ticker: string,
  articles: SourceRoot[]
): Promise<void> {
  await getRedis().set(
    tickerArticlesKey(ticker),
    JSON.stringify(articles),
    "EX",
    env.CACHE_TTL_ARTICLES_SEC
  );
}

const peersKey = (ticker: string) => `peers:${ticker}`;

export async function getPeersCache(ticker: string): Promise<string[] | null> {
  const data = await getRedis().get(peersKey(ticker));
  return data ? z.array(z.string()).parse(JSON.parse(data)) : null;
}

export async function setPeersCache(
  ticker: string,
  peers: string[]
): Promise<void> {
  await getRedis().set(
    peersKey(ticker),
    JSON.stringify(peers),
    "EX",
    env.CACHE_TTL_PEERS_SEC
  );
}
