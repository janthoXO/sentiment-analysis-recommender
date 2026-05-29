import type { SourceRoot } from "../generated/in/index.js";
import type { ArticlesCacheService } from "./articles.cache.js";
import type { StockCacheService } from "../stocks/stock.cache.js";
import type { SourceScoreRepo } from "../sentiment/source-score.repo.js";
import type { GetArticlesOptions } from "./articles.api.js";
import { sanitizeError, errorCode } from "../middleware/httpError.js";

export interface StreamError {
  error: string;
  code: string;
  ticker?: string;
}

export interface TickerArticles {
  ticker: string;
  sources: SourceRoot[];
  eventTSec?: number;
}

export interface FetchArticlesOpts {
  eventTSec?: number;
  intervalSec?: number;
}

export interface ArticlesService {
  streamArticlesByTickerIds(
    tickerIds: string[],
    opts?: FetchArticlesOpts
  ): AsyncGenerator<TickerArticles | StreamError>;
  streamArticlesForTicker(
    ticker: string,
    opts?: { eventTSec?: number[]; intervalSec?: number }
  ): AsyncGenerator<TickerArticles | StreamError>;
}

async function* yieldAsResolved<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  const pending = new Map<number, Promise<{ index: number; value: T }>>();
  promises.forEach((p, i) => {
    pending.set(
      i,
      p.then((value) => ({ index: i, value }))
    );
  });
  while (pending.size > 0) {
    const { index, value } = await Promise.race(pending.values());
    pending.delete(index);
    yield value;
  }
}

export function makeArticlesService({
  articlesCache,
  stockCache,
  sourceScoreRepo,
  getArticles,
}: {
  articlesCache: ArticlesCacheService;
  stockCache: StockCacheService;
  sourceScoreRepo: SourceScoreRepo;
  getArticles: (opts: GetArticlesOptions) => Promise<SourceRoot[]>;
}): ArticlesService {
  async function fetchArticlesWithCache(
    ticker: string,
    opts?: FetchArticlesOpts
  ): Promise<SourceRoot[]> {
    const { eventTSec, intervalSec } = opts ?? {};

    if (eventTSec !== undefined) {
      const cacheInterval = intervalSec ?? 0;
      let articles = await articlesCache.getEventArticlesCache(
        ticker,
        eventTSec,
        cacheInterval
      );
      if (articles === null) {
        articles = await getArticles({
          ticker,
          toSec: eventTSec,
          intervalSec,
        });
        await articlesCache.setEventArticlesCache(
          ticker,
          eventTSec,
          cacheInterval,
          articles
        );
      }
      return articles;
    }

    let articles = await stockCache.getTickerArticlesCache(ticker);
    if (articles === null) {
      articles = await getArticles({ ticker, intervalSec });
      if (articles.length > 0) {
        await stockCache.setTickerArticlesCache(ticker, articles);
      }
    } else {
      console.debug(
        `Article cache hit for ${ticker} (${articles.length} sources)`
      );
    }
    return articles;
  }

  return {
    async *streamArticlesByTickerIds(tickerIds, opts) {
      const upper = tickerIds
        .map((t) => t.toUpperCase().trim())
        .filter(Boolean);
      const promises = upper.map(
        async (ticker): Promise<TickerArticles | StreamError> => {
          try {
            const sources = await fetchArticlesWithCache(ticker, opts);
            await sourceScoreRepo.upsertManySourceMetadata(ticker, sources);
            return { ticker, sources };
          } catch (e) {
            console.error(`Article fetch failed for ${ticker}:`, e);
            return {
              error: sanitizeError(e, "Article fetch failed"),
              code: errorCode(e),
              ticker,
            } satisfies StreamError;
          }
        }
      );
      yield* yieldAsResolved(promises);
    },

    async *streamArticlesForTicker(ticker, opts) {
      const { eventTSec: eventTSecs, intervalSec } = opts ?? {};
      const upper = ticker.toUpperCase().trim();

      if (eventTSecs && eventTSecs.length > 0) {
        const promises = eventTSecs.map(
          async (tSec): Promise<TickerArticles | StreamError> => {
            try {
              const sources = await fetchArticlesWithCache(upper, {
                eventTSec: tSec,
                intervalSec,
              });
              await sourceScoreRepo.upsertManySourceMetadata(upper, sources);
              return { ticker: upper, sources, eventTSec: tSec };
            } catch (e) {
              console.error(
                `Article fetch failed for ${upper} at event ${tSec}:`,
                e
              );
              return {
                error: sanitizeError(e, "Article fetch failed"),
                code: errorCode(e),
                ticker: upper,
              } satisfies StreamError;
            }
          }
        );
        yield* yieldAsResolved(promises);
        return;
      }

      try {
        const sources = await fetchArticlesWithCache(upper, { intervalSec });
        await sourceScoreRepo.upsertManySourceMetadata(upper, sources);
        yield { ticker: upper, sources };
      } catch (e) {
        console.error(`Article fetch failed for ${upper}:`, e);
        yield {
          error: sanitizeError(e, "Article fetch failed"),
          code: errorCode(e),
          ticker: upper,
        } satisfies StreamError;
      }
    },
  };
}
