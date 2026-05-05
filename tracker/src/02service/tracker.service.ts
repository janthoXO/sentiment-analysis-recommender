import { getAllTrackJobs, persistTrackJob } from "@/03repo/redis.repo.js";
import { scrape } from "./scraper.service.js";
import { publishTask } from "@/03repo/mq.repo.js";
import { zTrackRequestRoot } from "@/api/generated/in/zod.gen.js";
import z from "zod";
import type { TrackRequestIntervalRoot } from "@/api/generated/in/index.js";

type TrackJob = z.infer<typeof zTrackRequestRoot>;

// In-memory store for running intervals so we don't duplicate them on the same instance
const activeJobs = new Map<
  string,
  { intervalId: NodeJS.Timeout; job: TrackRequestIntervalRoot }
>();

export async function track(
  stockId: string,
  ticker: string,
  priority: number,
  scanJobId?: string
): Promise<number> {
  try {
    const articles = await scrape(ticker);

    for (const a of articles) {
      publishTask(stockId, ticker, priority, a.snippet, a.url, scanJobId);
    }

    return articles.length;
  } catch (error) {
    console.error(`Error executing track for ${ticker}:`, error);
    return 0;
  }
}

export async function createTracker(tracker: TrackJob): Promise<number> {
  if (
    "expiration" in tracker &&
    "interval" in tracker &&
    tracker.interval > 0
  ) {
    tracker = await persistTrackJob(tracker);
    setupJobInterval(tracker);
  }

  const expectedCount = await track(
    tracker.stockId,
    tracker.ticker,
    tracker.priority,
    "scanJobId" in tracker ? tracker.scanJobId : undefined
  );

  return expectedCount;
}

export function setupJobInterval(job: TrackRequestIntervalRoot) {
  const jobKey = `${job.stockId}:${job.interval}`;
  const activeJob = activeJobs.get(jobKey);

  if (activeJob) {
    // Update in-memory expiration to the maximum
    activeJob.job.expiration = Math.max(
      activeJob.job.expiration,
      job.expiration
    );

    return;
  }

  const intervalId = setInterval(() => {
    const activeJob = activeJobs.get(jobKey);

    // Check against the in memory expiration date
    if (
      !activeJob ||
      Math.floor(Date.now() / 1000) >= activeJob.job.expiration
    ) {
      clearInterval(intervalId);
      activeJobs.delete(jobKey);
      return;
    }

    track(activeJob.job.stockId, activeJob.job.ticker, activeJob.job.priority);
  }, job.interval * 1000);

  activeJobs.set(jobKey, { intervalId, job });
}

export async function hydrateJobsOnStartup() {
  const jobs = await getAllTrackJobs();

  for (const job of jobs) {
    setupJobInterval(job);
    track(job.stockId, job.ticker, job.priority); // execute immediately on startup
    console.log(
      `Hydrated tracker interval for ${job.stockId} every ${job.interval}s`
    );
  }
}
