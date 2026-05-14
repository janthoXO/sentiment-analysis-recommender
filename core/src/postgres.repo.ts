import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "./env.js";
import * as schema from "./postgres.schema.js";
import path from "path";

const pool = new pg.Pool({ connectionString: env.DB_URL });
export const db = drizzle(pool, { schema });

export async function runMigrations() {
  console.log("⏳ Running migrations...");
  // Point this to the folder where your drizzle-kit migrations live
  await migrate(db, {
    migrationsFolder: path.join(import.meta.dirname, "../drizzle"),
  });
}
