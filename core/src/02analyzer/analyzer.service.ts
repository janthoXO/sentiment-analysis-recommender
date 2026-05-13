import type {
  SourceResultRoot,
  StockRoot,
  TickerResultRoot,
} from "@/generated/in/index.js";
import { getSourceScoreCache, setSourceScoreCache } from "./score.cache.js";
import * as scrapeService from "@/03scraper/finnhub.api.js";
import { setTickerCache } from "./ticker.cache.js";
import { publishAnalysisTask } from "@/mq.repo.js";

export type InFlightJob = {
  expected: number;
  stock: StockRoot;
  subscribers: {
    resolve: (result: TickerResultRoot | null) => void;
    reject: (error: Error) => void;
  }[]; // Callbacks to resolve/reject promises of subscribers
  results: SourceResultRoot[];
};

// maps from groupId to the in-flight job details
// can be both a query job or a interval job
const jobs = new Map<string, InFlightJob>();

// maps from ticker to groupId of a query
const highPriorityTickerToGroupId = new Map<string, string>();

export async function requestAnalysis(
  ticker: string,
  priority: number,
  timeoutMs?: number
): Promise<TickerResultRoot | null> {
  // scrape data
  const sources = await scrapeService.scrape(ticker);
  console.debug(`Scraped ${sources.length} sources for ${ticker}`);

  // check cache if scores already exist
  const cachedScores = await Promise.all(
    sources.map((s) => getSourceScoreCache(ticker, s.url))
  ).then((results) => results.filter((r) => r !== null));
  console.debug(
    `Cache hit for ${cachedScores.length} out of ${sources.length} sources for ${ticker}`
  );

  if (cachedScores.length === sources.length) {
    return {
      stock: { ticker, name: ticker },
      avgScore:
        cachedScores.reduce((sum, r) => sum + r.score, 0) / cachedScores.length,
      sources: cachedScores,
    };
  }

  const groupId = `${ticker}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    jobs.set(groupId, {
      expected: sources.length,
      stock: { ticker, name: ticker },
      subscribers: [{ resolve, reject }],
      results: cachedScores,
    });

    if (priority === 4) {
      highPriorityTickerToGroupId.set(ticker, groupId);
    }

    if (timeoutMs !== undefined) {
      setTimeout(() => resolveSubscriberEarly(groupId, resolve), timeoutMs);
    }

    for (const source of sources) {
      publishAnalysisTask(ticker, groupId, source, priority);
    }
  });
}

export function addSubscriber(
  groupId: string,
  timeoutMs?: number
): Promise<TickerResultRoot | null> {
  return new Promise((resolve, reject) => {
    const job = jobs.get(groupId);
    if (!job) {
      reject(new Error("Job not found"));
      return;
    }

    job.subscribers.push({ resolve, reject });

    if (timeoutMs !== undefined) {
      setTimeout(() => resolveSubscriberEarly(groupId, resolve), timeoutMs);
    }
  });
}

export function getCurrentResult(
  groupId: string,
  job?: InFlightJob
): TickerResultRoot | null {
  job = job || jobs.get(groupId);
  if (!job || job.results.length === 0) return null;

  const averageScore =
    job.results.reduce((sum, r) => sum + r.score, 0) / job.results.length;

  return {
    stock: job.stock,
    avgScore: averageScore,
    sources: job.results,
  };
}

export async function receiveResult(groupId: string, result: SourceResultRoot) {
  const job = jobs.get(groupId);
  if (!job) return;

  job.results.push(result);

  // save results to cache
  await setSourceScoreCache(job.stock.ticker, result);

  if (job.results.length < job.expected) {
    // still waiting for more results, do not resolve yet
    return;
  }

  // otherwise complete the job
  jobs.delete(groupId);
  if (highPriorityTickerToGroupId.get(job.stock.ticker) === groupId) {
    highPriorityTickerToGroupId.delete(job.stock.ticker);
  }

  const queryResult = getCurrentResult(groupId, job);

  for (const { resolve } of job.subscribers) {
    resolve(queryResult);
  }

  if (queryResult) {
    await setTickerCache(job.stock.ticker, queryResult);
  }
}

function resolveSubscriberEarly(
  groupId: string,
  resolve: (result: TickerResultRoot | null) => void
) {
  const job = jobs.get(groupId);
  if (!job) {
    resolve(null);
    return;
  }

  job.subscribers = job.subscribers.filter((s) => s.resolve !== resolve);
  // DO NOT clean up the job, so if results arrive later they will be cached

  // Give back whatever results have arrived so far
  resolve(getCurrentResult(groupId, job));
}

export function getInFlightGroupId(ticker: string): string | undefined {
  return highPriorityTickerToGroupId.get(ticker);
}
