import type { Root } from "@/api/generated/types.gen.js";

export type InFlightJob = {
  expected: number;
  received: number;
  ticker: string;
  figi: string;
  name: string;
  subscribers: ((result: Root) => void)[]; // Callbacks for when the job finishes
  buffer: Array<{ score: number | null; snippet: string; url: string }>;
  timer?: NodeJS.Timeout;
};

const jobs = new Map<string, InFlightJob>();
const tickerIndex = new Map<string, string>();

export async function register(
  scanJobId: string,
  {
    expected,
    ticker,
    figi,
    name,
  }: { expected: number; ticker: string; figi: string; name: string },
  timeoutCallback: () => void,
  timeoutMs: number
): Promise<Root> {
  return new Promise((resolve) => {
    const timer = setTimeout(timeoutCallback, timeoutMs);
    jobs.set(scanJobId, {
      expected,
      received: 0,
      ticker,
      figi,
      name,
      subscribers: [resolve],
      buffer: [],
      timer,
    });
    tickerIndex.set(ticker, scanJobId);
  });
}

export function addSubscriber(scanJobId: string): Promise<Root> {
  return new Promise((resolve, reject) => {
    const job = jobs.get(scanJobId);
    if (job) {
      job.subscribers.push(resolve);
    } else {
      reject(new Error("Job not found"));
    }
  });
}

export function receive(
  scanJobId: string,
  result: { score: number | null; snippet: string; url: string }
): boolean {
  const job = jobs.get(scanJobId);
  if (!job) return false;

  job.buffer.push(result);
  job.received++;

  return job.received >= job.expected;
}

export function finalize(scanJobId: string): InFlightJob | undefined {
  const job = jobs.get(scanJobId);
  if (!job) return undefined;

  if (job.timer) clearTimeout(job.timer);
  jobs.delete(scanJobId);
  tickerIndex.delete(job.ticker);
  return job;
}

export function getJobIdForTicker(ticker: string): string | undefined {
  return tickerIndex.get(ticker);
}
