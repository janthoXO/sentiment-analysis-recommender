import { zSourceResultRoot, zTickerResultRoot } from "@/generated/in/zod.gen.js";
import { getRedis } from "@/cache.repo.js";
import type { SourceResultRoot, TickerResultRoot } from "@/generated/in/index.js";
import { max } from "date-fns";

const singleSourceCacheKey = (ticker: string, url: string) =>
  `source-score:${ticker}:${url}`;

export async function getSingleSourceScoreCache(
  ticker: string,
  url: string
): Promise<SourceResultRoot | null> {
  const key = singleSourceCacheKey(ticker, url);
  const data = await getRedis().get(key);
  return data ? zSourceResultRoot.parse(JSON.parse(data)) : null;
}

/**
 * Sets the source score cache for a given ticker and source.
 * Only updates the cache if the new score is more recent than the existing cached score.
 */
export async function setSingleSourceScoreCache(
  ticker: string,
  sourceScore: SourceResultRoot
) {
  const key = singleSourceCacheKey(ticker, sourceScore.url);
  const prev = await getRedis().get(key);

  // Only update cache if new score is more recent than the cached one
  if (prev) {
    const prevParsed = zSourceResultRoot.parse(JSON.parse(prev));
    if (sourceScore.updatedAtSec <= prevParsed.updatedAtSec) {
      return; // Cached data is newer, skip update
    }
  }

  await getRedis().set(key, JSON.stringify(sourceScore));
}

const overallScoreCacheKey = (ticker: string) => `${ticker}`;

export async function getOverallScoreCache(
  ticker: string
): Promise<TickerResultRoot | null> {
  const key = overallScoreCacheKey(ticker);
  const data = await getRedis().get(key);
  return data ? zTickerResultRoot.parse(JSON.parse(data)) : null;
}

/**
 * Sets the ticker cache for a given ticker
 * Only updates the cache if the new ticker result has a more recent source than the cached one
 */
export async function setOverallScoreCache(
  ticker: string,
  searchResult: TickerResultRoot
) {
  const key = overallScoreCacheKey(ticker);
  const prev = await getRedis().get(key);

  // Only update cache if new score is more recent than the cached one
  if (prev) {
    if (
      max(searchResult.sources.map((s) => s.updatedAtSec)) <=
      max(
        zTickerResultRoot
          .parse(JSON.parse(prev))
          .sources.map((s) => s.updatedAtSec)
      )
    ) {
      return; // Cached data is newer, skip update
    }
  }

  await getRedis().set(key, JSON.stringify(searchResult));
}