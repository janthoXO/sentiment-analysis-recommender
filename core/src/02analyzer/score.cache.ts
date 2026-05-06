import { zSourceResultRoot } from "@/generated/in/zod.gen.js";
import { getRedis } from "@/cache.repo.js";
import type { SourceResultRoot } from "@/generated/in/index.js";

const cacheKey = (ticker: string, url: string) =>
  `source-score:${ticker}:${url}`;

export async function getSourceScoreCache(
  ticker: string,
  url: string
): Promise<SourceResultRoot | null> {
  const key = cacheKey(ticker, url);
  const data = await getRedis().get(key);
  return data ? zSourceResultRoot.parse(JSON.parse(data)) : null;
}

/**
 * Sets the source score cache for a given ticker and source.
 * Only updates the cache if the new score is more recent than the existing cached score.
 */
export async function setSourceScoreCache(
  ticker: string,
  sourceScore: SourceResultRoot
) {
  const key = cacheKey(ticker, sourceScore.url);
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
