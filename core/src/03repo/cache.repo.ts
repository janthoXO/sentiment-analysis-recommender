import { Redis } from "ioredis";
import { env } from "../env.js";
import type { Root } from "@/api/generated/in/index.js";

let redis: Redis;

export function initCache() {
  redis = new Redis(env.CACHE_URL);
}

export async function get(ticker: string) {
  if (!redis) initCache();
  const data = await redis.get(ticker);
  return data ? JSON.parse(data) : null;
}

export async function set(ticker: string, data: Root) {
  if (!redis) initCache();
  await redis.set(ticker, JSON.stringify(data), "EX", env.CACHE_TTL_SECONDS);
}
