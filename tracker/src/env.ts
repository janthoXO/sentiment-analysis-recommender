import dotenv from "dotenv";
import z from "zod";

dotenv.config();

export const EnvSchema = z.object({
  PORT: z.coerce.number().default(3002),
  DEBUG: z.coerce.boolean().default(false),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  RABBITMQ_URL: z.string().default("amqp://sentinel:sentinel@localhost:5672"),
  FINNHUB_KEY: z.string(),
  MAX_ARTICLES: z.coerce.number().default(10),
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
