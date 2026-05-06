import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { env } from "./src/env.js";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/postgres.schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DB_URL,
  },
});
