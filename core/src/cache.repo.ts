import { Redis } from "ioredis";
import { env } from "./env.js";

let redis: Redis;

export function initCache() {
  redis = new Redis(env.CACHE_URL);
}

export function getRedis() {
  if (!redis) initCache();
  return redis;
}
