import type {
  SourceResultRoot,
  StockRoot,
  TickerResultRoot,
} from "@/generated/in/index.js";
import { getSourceScore, upsertManySourceScores } from "./source-score.repo.js";
import { upsertTickerStock } from "@/01search/ticker-stock.repo.js";
import {
  getTickerArticlesCache,
  setTickerArticlesCache,
} from "@/01search/stock.cache.js";
import { publishAnalysisTask } from "@/mq.repo.js";
import { getArticlesByTicker } from "@/articles/articles.api.js";
import { calculateAverageScore } from "./score.util.js";
import { sentimentEmitter } from "../events.js";

export type InFlightJob = {
  stock: StockRoot;
  subscribers: {
    resolve: (result: TickerResultRoot | null) => void;
    reject: (error: Error) => void;
  }[];
  cachedResults: SourceResultRoot[];
};

const jobs = new Map<string, InFlightJob>();
const highPriorityTickerToJobId = new Map<string, string>();

export async function requestAnalysis(
  stock: StockRoot,
  priority: number
): Promise<TickerResultRoot | null> {
  // ensure ticker_stock row exists so source_score FK is satisfied
  await upsertTickerStock(stock);

  // check article cache before hitting Finnhub
  let sources = await getTickerArticlesCache(stock.ticker);
  if (sources === null) {
    sources = await getArticlesByTicker(stock.ticker);
    console.debug(`Scraped ${sources.length} sources for ${stock.ticker}`);
    if (sources.length > 0) {
      await setTickerArticlesCache(stock.ticker, sources);
    }
  } else {
    console.debug(
      `Article cache hit for ${stock.ticker} (${sources.length} sources)`
    );
  }

  if (sources.length === 0) {
    return null;
  }

  // check Postgres source_score for already-scored sources
  const cachedScores = await Promise.all(
    sources.map((s) => getSourceScore(stock.ticker, s.url))
  ).then((results) => results.filter((r) => r !== null));
  console.debug(
    `Source score cache hit for ${cachedScores.length} out of ${sources.length} sources for ${stock.ticker}`
  );

  if (cachedScores.length === sources.length) {
    return {
      stock: stock,
      avgScore: calculateAverageScore(cachedScores),
      sources: cachedScores,
    };
  }

  const jobId = `${stock.ticker}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    jobs.set(jobId, {
      stock: stock,
      subscribers: [{ resolve, reject }],
      cachedResults: cachedScores,
    });

    if (priority === 4) {
      highPriorityTickerToJobId.set(stock.ticker, jobId);
    }

    const uncachedSources = sources.filter(
      (s) => !cachedScores.some((cs) => cs.url === s.url)
    );

    if (uncachedSources.length > 0) {
      publishAnalysisTask(stock.ticker, jobId, uncachedSources, priority);
    } else {
      receiveResult(jobId, []);
    }
  });
}

export function addSubscriber(jobId: string): Promise<TickerResultRoot | null> {
  return new Promise((resolve, reject) => {
    const job = jobs.get(jobId);
    if (!job) {
      reject(new Error("Job not found"));
      return;
    }
    job.subscribers.push({ resolve, reject });
  });
}

export async function receiveResult(
  jobId: string,
  results: SourceResultRoot[]
) {
  const job = jobs.get(jobId);
  if (!job) return;

  await upsertManySourceScores(job.stock.ticker, results);

  jobs.delete(jobId);
  if (highPriorityTickerToJobId.get(job.stock.ticker) === jobId) {
    highPriorityTickerToJobId.delete(job.stock.ticker);
  }

  const allResults = [...job.cachedResults, ...results];
  const queryResult: TickerResultRoot = {
    stock: job.stock,
    avgScore: calculateAverageScore(allResults),
    sources: allResults,
  };

  for (const { resolve } of job.subscribers) {
    resolve(queryResult);
  }

  sentimentEmitter.emit("sentiment-update", {
    ticker: job.stock.ticker,
    result: queryResult,
  });
}

export function getInFlightJobId(ticker: string): string | undefined {
  return highPriorityTickerToJobId.get(ticker);
}
