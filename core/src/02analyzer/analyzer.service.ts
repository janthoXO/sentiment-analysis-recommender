import { createHash } from "crypto";
import type {
  SourceResultRoot,
  SourceRoot,
  StockRoot,
  TickerResultRoot,
} from "@/generated/in/index.js";
import { getSourceScore, upsertManySourceScores } from "./source-score.repo.js";
import { upsertTickerStock } from "@/01search/ticker-stock.repo.js";
import { publishAnalysisTask } from "@/mq.repo.js";
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
const inFlightToJobId = new Map<string, string>();
const jobIdToKey = new Map<string, string>(); // reverse of inFlightToJobId for O(1) cleanup

function hashArticleUrls(articles: SourceRoot[]): string {
  const sorted = articles.map((a) => a.url).sort().join("\n");
  return createHash("sha256").update(sorted).digest("hex");
}

function inFlightKey(ticker: string, urlHash: string, priority: number): string {
  return `${ticker}:${urlHash}:${priority}`;
}

export function getInFlightJobId(ticker: string, urlHash: string, priority: number): string | undefined {
  return inFlightToJobId.get(inFlightKey(ticker, urlHash, priority));
}

export async function analyzeArticles(
  stock: StockRoot,
  articles: SourceRoot[],
  priority: number
): Promise<TickerResultRoot | null> {
  if (articles.length === 0) return null;

  await upsertTickerStock(stock);

  const cachedScores = await Promise.all(
    articles.map((s) => getSourceScore(stock.ticker, s.url))
  ).then((results) => results.filter((r) => r !== null));
  console.debug(
    `Source score cache hit for ${cachedScores.length} out of ${articles.length} sources for ${stock.ticker}`
  );

  if (cachedScores.length === articles.length) {
    return {
      stock,
      avgScore: calculateAverageScore(cachedScores),
      sources: cachedScores,
    };
  }

  const urlHash = hashArticleUrls(articles);
  const key = inFlightKey(stock.ticker, urlHash, priority);
  const existingJobId = inFlightToJobId.get(key);
  if (existingJobId) {
    return addSubscriber(existingJobId);
  }

  const jobId = `${stock.ticker}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    jobs.set(jobId, {
      stock,
      subscribers: [{ resolve, reject }],
      cachedResults: cachedScores,
    });
    inFlightToJobId.set(key, jobId);
    jobIdToKey.set(jobId, key);

    const uncachedSources = articles.filter(
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
  const key = jobIdToKey.get(jobId);
  if (key) {
    inFlightToJobId.delete(key);
    jobIdToKey.delete(jobId);
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
