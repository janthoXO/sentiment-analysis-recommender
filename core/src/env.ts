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

  CACHE_TTL_SECONDS: z.coerce.number().default(900),
  CACHE_TTL_QUERY_SEC: z.coerce.number().default(86400),
  CACHE_TTL_ARTICLES_SEC: z.coerce.number().default(3600),
  CACHE_TTL_PEERS_SEC: z.coerce.number().int().positive().default(86400),
  CACHE_MIN_SOURCES: z.coerce.number().default(3),
  GROUP_TIMEOUT_MS: z.coerce.number().default(15000),

  FINNHUB_API_KEY: z.string(),
  MAX_ARTICLES: z.coerce.number().default(10),
  TRENDING_REFRESH_INTERVAL_SEC: z.coerce.number().default(60 * 60),
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
