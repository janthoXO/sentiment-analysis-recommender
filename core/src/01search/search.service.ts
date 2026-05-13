import type { StockRoot, TickerResultRoot } from "@/generated/in/index.js";
import { searchTickers } from "../figi/polygon.api.js";
import * as analyzeService from "@/02analyzer/analyzer.service.js";
import { env } from "@/env.js";
import { getQueryStockCache, setQueryStockCache } from "./stock.cache.js";
import { getOverallScoreCache } from "@/02analyzer/score.cache.js";

async function processStock(stock: StockRoot): Promise<TickerResultRoot> {
  const cached = await getOverallScoreCache(stock.ticker);
  if (cached) {
    console.debug(`Cache hit for ${stock.ticker}`);
    return cached;
  }

  // check if there is already a inflight request with high priority
  const groupId = analyzeService.getInFlightGroupId(stock.ticker);
  console.debug(`Existing in-flight job: ${groupId ? "Yes" : "No"}`);

  const result = await (groupId
    ? analyzeService.addSubscriber(groupId, env.GROUP_TIMEOUT_MS)
    : analyzeService.requestAnalysis(stock.ticker, 4, env.GROUP_TIMEOUT_MS));
  if (result === null) {
    throw new Error(`Failed to get analysis result for ${stock.ticker}`);
  }

  return result;
}

export async function* processQuery(
  q: string
): AsyncGenerator<TickerResultRoot | { error: string }> {
  let stocks = await getQueryStockCache(q);
  if (stocks === null) {
    stocks = await searchTickers(q);

    if (stocks === null || stocks.length === 0) {
      yield { error: "No tickers found" };
      return;
    }

    await setQueryStockCache(q, stocks);
  }

  // Fire off all ticker requests CONCURRENTLY
  const promises = stocks.map(async (stock) => {
    try {
      return await processStock(stock);
    } catch (e) {
      console.error(`Error processing ${stock.ticker}:`, e);
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
