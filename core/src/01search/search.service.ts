import type { StockRoot, TickerResultRoot } from "@/generated/in/index.js";
import * as analyzeService from "@/02analyzer/analyzer.service.js";
import { getQueryStockCache, setQueryStockCache } from "./stock.cache.js";
import {
  countFreshSourceScoresForTicker,
  listFreshSourceScoresForTicker,
} from "@/02analyzer/source-score.repo.js";
import { getTickerStock, upsertManyTickerStocks } from "./ticker-stock.repo.js";
import { calculateAverageScore } from "@/02analyzer/score.util.js";
import { searchTickers } from "@/stocks/stocks.api.js";
import { env } from "@/env.js";

export async function processStock(
  stock: StockRoot
): Promise<TickerResultRoot | null> {
  const count = await countFreshSourceScoresForTicker(stock.ticker);

  if (count >= env.CACHE_MIN_SOURCES) {
    console.debug(
      `Source score cache sufficient for ${stock.ticker} (${count} entries)`
    );
    const sources = await listFreshSourceScoresForTicker(stock.ticker);
    return { stock, sources, avgScore: calculateAverageScore(sources) };
  }

  const jobId = analyzeService.getInFlightJobId(stock.ticker);
  console.debug(`Existing in-flight job: ${jobId ? "Yes" : "No"}`);

  const result = await (jobId
    ? analyzeService.addSubscriber(jobId)
    : analyzeService.requestAnalysis(stock, 4));

  if (result === null) {
    throw new Error(`Failed to get analysis result for ${stock.ticker}`);
  }

  // return the result with the correct stock metadata (name from DB, not ticker fallback)
  return { ...result, stock };
}

export async function* processQuery(
  q: string
): AsyncGenerator<TickerResultRoot | { error: string }> {
  const qUpper = q.toUpperCase().trim();

  // direct ticker cache lookup
  const directHit = await getTickerStock(qUpper);
  if (directHit) {
    console.debug(`Direct ticker cache hit for ${qUpper}`);
    try {
      const result = await processStock(directHit);
      if (result) yield result;
    } catch (e) {
      console.error(`Error processing direct ticker ${qUpper}:`, e);
    }
    return;
  }

  // query cache lookup
  let stocks = await getQueryStockCache(q);
  if (stocks !== null) {
    console.debug(`Query cache hit for "${q}" (${stocks.length} tickers)`);
  } else {
    stocks = await searchTickers(q);

    if (stocks.length === 0) {
      yield { error: "No tickers found" };
      return;
    }

    await upsertManyTickerStocks(stocks);

    const isDirectTickerQuery =
      stocks.length === 1 && stocks[0]!.ticker.toUpperCase() === qUpper;

    if (!isDirectTickerQuery) {
      await setQueryStockCache(q, stocks);
    }
  }

  const promises = stocks.map(async (stock) => {
    try {
      return await processStock(stock);
    } catch (e) {
      console.error(`Error processing ${stock.ticker}:`, e);
      return null;
    }
  });

  const pending = new Map<
    number,
    Promise<{ index: number; result: TickerResultRoot | null }>
  >();

  promises.forEach((p, index) => {
    pending.set(
      index,
      p.then((result) => ({ index, result }))
    );
  });

  while (pending.size > 0) {
    const resolved = await Promise.race(pending.values());
    pending.delete(resolved.index);
    if (resolved.result !== null) {
      yield resolved.result;
    }
  }
}
