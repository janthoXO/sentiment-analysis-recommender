import { zTickerResultRoot } from "@/generated/in/zod.gen.js";
import { getRedis } from "@/cache.repo.js";
import type { TickerResultRoot } from "@/generated/in/index.js";
import { max } from "date-fns";

const cacheKey = (ticker: string) => `${ticker}`;

export async function getTickerCache(
  ticker: string
): Promise<TickerResultRoot | null> {
  const key = cacheKey(ticker);
  const data = await getRedis().get(key);
  return data ? zTickerResultRoot.parse(JSON.parse(data)) : null;
}

/**
 * Sets the ticker cache for a given ticker
 * Only updates the cache if the new ticker result has a more recent source than the cached one
 */
export async function setTickerCache(
  ticker: string,
  searchResult: TickerResultRoot
) {
  const key = cacheKey(ticker);
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
