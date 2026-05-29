import type { RedisClient } from "../utils/cache.repo.js";
import type { SourceRoot } from "../generated/in/index.js";

// Events are historical; their article set doesn't change once the window has passed.
const TTL = 86_400;

const eventKey = (ticker: string, eventTSec: number, intervalSec: number) =>
  `event-articles:${ticker}:${eventTSec}:${intervalSec}`;

export interface ArticlesCacheService {
  getEventArticlesCache(
    ticker: string,
    eventTSec: number,
    intervalSec: number
  ): Promise<SourceRoot[] | null>;
  setEventArticlesCache(
    ticker: string,
    eventTSec: number,
    intervalSec: number,
    articles: SourceRoot[]
  ): Promise<void>;
}

export function makeArticlesCache(redis: RedisClient): ArticlesCacheService {
  return {
    async getEventArticlesCache(ticker, eventTSec, intervalSec) {
      const data = await redis.get(eventKey(ticker, eventTSec, intervalSec));
      return data ? (JSON.parse(data) as SourceRoot[]) : null;
    },

    async setEventArticlesCache(ticker, eventTSec, intervalSec, articles) {
      await redis.set(
        eventKey(ticker, eventTSec, intervalSec),
        JSON.stringify(articles),
        "EX",
        TTL
      );
    },
  };
}
