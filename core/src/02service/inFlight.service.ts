import type {
  Root,
  SourceResultRoot,
  StockRoot,
} from "@/api/generated/in/index.js";
import * as cache from "@/03repo/cache.repo.js";

export type InFlightJob = {
  expected: number;
  received: number;
  stock: StockRoot;
  subscribers: {
    resolve: (result: Root) => void;
    reject: (error: Error) => void;
  }[]; // Callbacks to resolve/reject promises of subscribers
  buffer: SourceResultRoot[];
  timer?: NodeJS.Timeout;
};

const jobs = new Map<string, InFlightJob>();
const tickerIndex = new Map<string, string>();

export async function register(
  scanJobId: string,
  expected: number,
  stock: StockRoot,
  timeoutCallback: () => void,
  timeoutMs: number
): Promise<Root> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(timeoutCallback, timeoutMs);
    jobs.set(scanJobId, {
      expected,
      received: 0,
      stock,
      subscribers: [{ resolve, reject }],
      buffer: [],
      timer,
    });

    tickerIndex.set(stock.ticker, scanJobId);
  });
}

export function addSubscriber(scanJobId: string): Promise<Root> {
  return new Promise((resolve, reject) => {
    const job = jobs.get(scanJobId);
    if (job) {
      job.subscribers.push({ resolve, reject });
    } else {
      reject(new Error("Job not found"));
    }
  });
}

export async function receive(scanJobId: string, result: SourceResultRoot) {
  const job = jobs.get(scanJobId);
  if (!job) return;

  job.buffer.push(result);
  job.received++;

  if (job.received < job.expected) {
    return;
  }

  await finalizeJob(scanJobId, job);
}

export async function finalizeJob(scanJobId: string, job?: InFlightJob) {
  job = job || jobs.get(scanJobId);
  if (!job) return;

  // otherwise complete the job
  if (job.timer) clearTimeout(job.timer);
  jobs.delete(scanJobId);
  tickerIndex.delete(job.stock.ticker);

  const averageScore =
    job.buffer.reduce((sum, r) => sum + r.score, 0) / job.buffer.length;

  const queryResult: Root = {
    stock: job.stock,
    score: averageScore,
    sources: job.buffer,
  };

  if (job.buffer.length > 0) {
    await cache.set(job.stock.ticker, queryResult);
  }

  for (const { resolve } of job.subscribers) {
    resolve(queryResult);
  }
}

export function getJobIdForTicker(ticker: string): string | undefined {
  return tickerIndex.get(ticker);
}
