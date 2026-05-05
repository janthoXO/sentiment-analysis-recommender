import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { env } from "./src/env.js";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/03repo/postgres.schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.POSTGRES_URL,
  },
});
