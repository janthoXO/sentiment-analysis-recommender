import dotenv from "dotenv";
import z from "zod";

dotenv.config();

export const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DEBUG: z.coerce.boolean().default(false),

  CACHE_URL: z.string().default("redis://default:sentinel@localhost:6379"),
  DB_URL: z
    .string()
    .default("postgresql://sentinel:sentinel@localhost:5432/sentinel"),
  RABBITMQ_URL: z.string().default("amqp://sentinel:sentinel@localhost:5672"),
  MQ_EXCHANGE: z.string().default("sentinel.analyze"),

  CACHE_TTL_SECONDS: z.coerce.number().default(900),
  CACHE_TTL_QUERY_SEC: z.coerce.number().default(86400),
  CACHE_TTL_ARTICLES_SEC: z.coerce.number().default(3600),
  CACHE_TTL_PEERS_SEC: z.coerce.number().int().positive().default(86400),
  CACHE_MIN_SOURCES: z.coerce.number().default(3),
  GROUP_TIMEOUT_MS: z.coerce.number().default(15000),

  FINNHUB_API_KEY: z.string(),

  MAX_ARTICLES_PER_TICKER: z.coerce.number().default(10),
  MIN_ARTICLES_PER_TICKER: z.coerce.number().default(5),

  USER_QUERY_PRIORITY: z.coerce.number().default(4),

  TOP_TICKERS_REFRESH_INTERVAL_SEC: z.coerce
    .number()
    .default(4 * 7 * 24 * 60 * 60), // 4 weeks
  TOP_TICKERS_SCRAPE_INTERVAL_SEC: z.coerce.number().default(6 * 60 * 60), // 6 hours
  TOP_TICKERS_JITTER_SEC: z.coerce.number().default(30 * 60), // 30 minutes
  TOP_TICKERS_PRIORITY: z.coerce.number().default(1),

  TRENDING_REFRESH_INTERVAL_SEC: z.coerce.number().default(60 * 60), // 1 hour
  TRENDING_SCRAPE_INTERVAL_SEC: z.coerce.number().default(10 * 60), // 10 minutes
  TRENDING_TICKERS_JITTER_SEC: z.coerce.number().default(2 * 60), // 2 minutes
  TRENDING_PRIORITY: z.coerce.number().default(3),

  WATCHLIST_SCRAPE_INTERVAL_SEC: z.coerce.number().default(60 * 60), // 1 hour
  WATCHLIST_PRIORITY: z.coerce.number().default(2),

  NOTIFICATION_DEBOUNCE_SEC: z.coerce.number().default(30),
  NOTIFICATION_TOP_N: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsed.error, null, 2)
  );
  process.exit(1);
}
export const env = parsed.data;
