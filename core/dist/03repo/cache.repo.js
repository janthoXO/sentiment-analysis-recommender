import { Redis } from "ioredis";
import { env } from "../env.js";
let redis;
export function initCache() {
    redis = new Redis(env.CORE_REDIS_URL);
}
export async function get(ticker) {
    if (!redis)
        initCache();
    const data = await redis.get(ticker);
    return data ? JSON.parse(data) : null;
}
export async function set(ticker, data) {
    if (!redis)
        initCache();
    await redis.set(ticker, JSON.stringify(data), "EX", env.CACHE_TTL_SECONDS);
}
//# sourceMappingURL=cache.repo.js.map