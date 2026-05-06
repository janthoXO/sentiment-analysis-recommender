import { createClient } from "redis";
import { env } from "../env.js";
import type { TrackRequestIntervalRoot } from "@/api/generated/in/index.js";
import { zTrackRequestIntervalRoot } from "@/api/generated/in/zod.gen.js";

export const redisClient = createClient({
  url: env.REDIS_URL,
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

export const connectRedis = async () => {
  await redisClient.connect();
};

const trackJobKey = (ticker: string, interval: number) =>
  `trackJob:${ticker}:${interval}`;

export async function getTrackJob(
  ticker: string,
  interval: number
): Promise<TrackRequestIntervalRoot | null> {
  const jobKey = trackJobKey(ticker, interval);
  const data = await redisClient.get(jobKey);
  if (!data) return null;

  return zTrackRequestIntervalRoot.parse(data);
}

export async function getAllTrackJobs(): Promise<TrackRequestIntervalRoot[]> {
  const keys = await redisClient.keys("trackJob:*");
  const jobs: TrackRequestIntervalRoot[] = [];

  await Promise.all(
    keys.map(async (key) => {
      const data = await redisClient.get(key);
      if (data) {
        try {
          const job = zTrackRequestIntervalRoot.parse(data);
          jobs.push(job);
        } catch (e) {
          console.error(`Invalid track job data for key ${key}:`, e);
        }
      }
    })
  );

  return jobs;
}

export async function persistTrackJob(
  job: TrackRequestIntervalRoot
): Promise<TrackRequestIntervalRoot> {
  const jobKey = trackJobKey(job.ticker, job.interval);

  const existingData = await redisClient
    .get(jobKey)
    .then((data) => (data ? zTrackRequestIntervalRoot.parse(data) : null));
  if (existingData) {
    job.expiration = Math.max(job.expiration, existingData.expiration);
  }

  const ttl = Math.max(0, job.expiration - Math.floor(Date.now() / 1000));
  if (ttl > 0) {
    await redisClient.set(jobKey, JSON.stringify(job), {
      EX: ttl,
    });
  }

  return job;
}
