import dotenv from "dotenv";
import z from "zod";

dotenv.config();

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}, z.boolean());

export const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DEBUG: z.coerce.boolean().default(false),

  CACHE_URL: z.string().default("redis://default:sentinel@localhost:6379"),
  DB_URL: z
    .string()
    .default("postgresql://sentinel:sentinel@localhost:5432/sentinel"),
  RABBITMQ_URL: z.string().default("amqp://sentinel:sentinel@localhost:5672"),

  CACHE_TTL_SECONDS: z.coerce.number().default(900),
  CACHE_TTL_QUERY_SEC: z.coerce.number().default(86400),
  CACHE_TTL_ARTICLES_SEC: z.coerce.number().default(3600),
  CACHE_TTL_PEERS_SEC: z.coerce.number().int().positive().default(86400),
  CACHE_MIN_SOURCES: z.coerce.number().default(3),
  GROUP_TIMEOUT_MS: z.coerce.number().default(15000),

  FINNHUB_API_KEY: z.string(),
  LLM_PROVIDER: z.enum(["none", "gemini"]).default("none"),
  LLM_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_API_KEY: z.string().optional(),
  LLM_THEME_MAX_TICKERS: z.coerce.number().int().positive().max(20).default(5),
  LLM_THEME_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  LLM_INSIGHT_ENABLED: booleanEnv.default(false),
  LLM_INSIGHT_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(6),
  LLM_INSIGHT_MAX_ARTICLES: z.coerce
    .number()
    .int()
    .positive()
    .max(10)
    .default(6),
  LLM_INSIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  CACHE_TTL_INSIGHT_SEC: z.coerce.number().int().positive().default(3600),
  MAX_ARTICLES: z.coerce.number().default(10),
  TOP_TICKERS_REFRESH_INTERVAL_SEC: z.coerce
    .number()
    .default(4 * 7 * 24 * 60 * 60), // 4 weeks
  TOP_TICKERS_SCRAPE_INTERVAL_SEC: z.coerce.number().default(6 * 60 * 60), // 6 hours
  TOP_TICKERS_JITTER_SEC: z.coerce.number().default(30 * 60), // 30 minutes
  TRENDING_REFRESH_INTERVAL_SEC: z.coerce.number().default(60 * 60), // 1 hour
  TRENDING_SCRAPE_INTERVAL_SEC: z.coerce.number().default(10 * 60), // 10 minutes
  TRENDING_TICKERS_JITTER_SEC: z.coerce.number().default(2 * 60), // 2 minutes
  WATCHLIST_SCRAPE_INTERVAL_SEC: z.coerce.number().default(60 * 60), // 1 hour
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
