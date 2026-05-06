import type { TickerResultRoot } from "@/generated/in/index.js";
import { fetchFigiForTicker } from "../figi/polygon.api.js";
import { getStock, saveStock } from "@/figi/stock.repo.js";
import { getTickerCache } from "../02analyzer/ticker.cache.js";
import * as analyzeService from "@/02analyzer/analyzer.service.js";
import { env } from "@/env.js";

export async function* processTickers(
  tickers: string[]
): AsyncGenerator<TickerResultRoot> {
  // logic for a single ticker into an async helper function
  const processSingleTicker = async (
    ticker: string
  ): Promise<TickerResultRoot> => {
    let stockInfo = await getStock(ticker);
    if (!stockInfo) {
      console.debug(
        `Stock info for ${ticker} not found in DB, fetching from Polygon...`
      );
      const polygonData = await fetchFigiForTicker(ticker);
      stockInfo = polygonData;
      await saveStock(polygonData);
    }

    const cached = await getTickerCache(stockInfo.ticker);
    if (cached) {
      console.debug(`Cache hit for ${stockInfo.ticker}`);
      return cached;
    }

    // check if there is already a inflight request with high priority
    const groupId = analyzeService.getInFlightGroupId(ticker);
    console.debug(`Existing in-flight job: ${groupId ? "Yes" : "No"}`);

    const result = await (groupId
      ? analyzeService.addSubscriber(groupId, env.GROUP_TIMEOUT_MS)
      : analyzeService.requestAnalysis(ticker, 4, env.GROUP_TIMEOUT_MS));
    if (result === null) {
      throw new Error(`Failed to get analysis result for ${ticker}`);
    }

    return result;
  };

  // Fire off all ticker requests CONCURRENTLY
  const promises = tickers.map(async (ticker) => {
    try {
      return await processSingleTicker(ticker);
    } catch (e) {
      console.error(`Error processing ${ticker}:`, e);
      return null;
    }
  });

  // Create a Map to hold the pending promises, keyed by their array index
  const pending = new Map<
    number,
    Promise<{ index: number; result: TickerResultRoot | null }>
  >();

  promises.forEach((p, index) => {
    // Wrap each promise to return its result AND its original index
    pending.set(
      index,
      p.then((result) => ({ index, result }))
    );
  });

  while (pending.size > 0) {
    // Promise.race gets the fastest promise
    const resolved = await Promise.race(pending.values());

    // Remove it from the Map using the index
    pending.delete(resolved.index);

    // Yield the result to the router immediately if it didn't fail
    if (resolved.result !== null) {
      yield resolved.result;
    }
  }
}

export async function* processTopic(): AsyncGenerator<TickerResultRoot> {
// topic: string
  // convert topic to tickers

  yield* processTickers([
    /* array of tickers extracted from topic */
  ]);
}
