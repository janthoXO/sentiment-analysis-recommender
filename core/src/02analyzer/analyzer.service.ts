import type {
  SourceResultRoot,
  StockRoot,
  TickerResultRoot,
} from "@/generated/in/index.js";
import {
  getSingleSourceScoreCache,
  setOverallScoreCache,
  setSingleSourceScoreCache,
} from "./score.cache.js";
import { publishAnalysisTask } from "@/mq.repo.js";
import { getArticlesByTicker } from "@/articles/articles.api.js";

export type InFlightJob = {
  stock: StockRoot;
  subscribers: {
    resolve: (result: TickerResultRoot | null) => void;
    reject: (error: Error) => void;
  }[]; // Callbacks to resolve/reject promises of subscribers
  cachedResults: SourceResultRoot[];
};

// maps from jobId to the in-flight job details
// can be both a query job or a interval job
const jobs = new Map<string, InFlightJob>();

// maps from ticker to jobId of a query
const highPriorityTickerToJobId = new Map<string, string>();

function calculateAverageScore(results: SourceResultRoot[]): number {
  if (results.length === 0) return 0;

  return results.reduce((sum, r) => sum + r.score, 0) / results.length;
}

export async function requestAnalysis(
  ticker: string,
  priority: number
): Promise<TickerResultRoot | null> {
  // scrape data
  const sources = await getArticlesByTicker(ticker);
  console.debug(`Scraped ${sources.length} sources for ${ticker}`);

  if (sources.length === 0) {
    return null;
  }

  // check cache if scores already exist
  const cachedScores = await Promise.all(
    sources.map((s) => getSingleSourceScoreCache(ticker, s.url))
  ).then((results) => results.filter((r) => r !== null));
  console.debug(
    `Cache hit for ${cachedScores.length} out of ${sources.length} sources for ${ticker}`
  );

  if (cachedScores.length === sources.length) {
    return {
      stock: { ticker, name: ticker },
      avgScore: calculateAverageScore(cachedScores),
      sources: cachedScores,
    };
  }

  const jobId = `${ticker}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    jobs.set(jobId, {
      stock: { ticker, name: ticker },
      subscribers: [{ resolve, reject }],
      cachedResults: cachedScores,
    });

    if (priority === 4) {
      highPriorityTickerToJobId.set(ticker, jobId);
    }

    const uncachedSources = sources.filter(
      (s) => !cachedScores.some((cs) => cs.url === s.url)
    );

    if (uncachedSources.length > 0) {
      publishAnalysisTask(ticker, jobId, uncachedSources, priority);
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

  // save results to cache
  await Promise.all(
    results.map((r) => setSingleSourceScoreCache(job.stock.ticker, r))
  );

  jobs.delete(jobId);
  if (highPriorityTickerToJobId.get(job.stock.ticker) === jobId) {
    highPriorityTickerToJobId.delete(job.stock.ticker);
  }

  const overallResult = [...job.cachedResults, ...results];
  const queryResult: TickerResultRoot = {
    stock: job.stock,
    avgScore: calculateAverageScore(overallResult),
    sources: overallResult,
  };

  for (const { resolve } of job.subscribers) {
    resolve(queryResult);
  }

  if (queryResult) {
    await setOverallScoreCache(job.stock.ticker, queryResult);
  }
}

export function getInFlightJobId(ticker: string): string | undefined {
  return highPriorityTickerToJobId.get(ticker);
}
