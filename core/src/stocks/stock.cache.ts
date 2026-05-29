import z from "zod";
import { zSourceRoot, zStockRoot } from "../generated/in/zod.gen.js";
import type { RedisClient } from "../utils/cache.repo.js";
import type { SourceRoot, StockRoot } from "../generated/in/index.js";
import { env } from "../env.js";

const queryStockKey = (query: string) => `query-stock:${query}`;
const tickerArticlesKey = (ticker: string) => `ticker-articles:${ticker}`;
const peersKey = (ticker: string) => `peers:${ticker}`;

export interface StockCacheService {
  getQueryStockCache(query: string): Promise<StockRoot[] | null>;
  setQueryStockCache(query: string, stocks: StockRoot[]): Promise<void>;
  getTickerArticlesCache(ticker: string): Promise<SourceRoot[] | null>;
  setTickerArticlesCache(ticker: string, articles: SourceRoot[]): Promise<void>;
  getPeersCache(ticker: string): Promise<string[] | null>;
  setPeersCache(ticker: string, peers: string[]): Promise<void>;
}

export function makeStockCache(redis: RedisClient): StockCacheService {
  return {
    async getQueryStockCache(query) {
      const data = await redis.get(queryStockKey(query));
      return data ? zStockRoot.array().parse(JSON.parse(data)) : null;
    },

    async setQueryStockCache(query, stocks) {
      await redis.set(
        queryStockKey(query),
        JSON.stringify(stocks),
        "EX",
        env.CACHE_TTL_QUERY_SEC
      );
    },

    async getTickerArticlesCache(ticker) {
      const data = await redis.get(tickerArticlesKey(ticker));
      return data ? zSourceRoot.array().parse(JSON.parse(data)) : null;
    },

    async setTickerArticlesCache(ticker, articles) {
      await redis.set(
        tickerArticlesKey(ticker),
        JSON.stringify(articles),
        "EX",
        env.CACHE_TTL_ARTICLES_SEC
      );
    },

    async getPeersCache(ticker) {
      const data = await redis.get(peersKey(ticker));
      return data ? z.array(z.string()).parse(JSON.parse(data)) : null;
    },

    async setPeersCache(ticker, peers) {
      await redis.set(
        peersKey(ticker),
        JSON.stringify(peers),
        "EX",
        env.CACHE_TTL_PEERS_SEC
      );
    },
  };
}
