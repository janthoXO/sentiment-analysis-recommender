import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "./env.js";
import { stockSchema } from "./postgres.schema.js";

const pool = new pg.Pool({ connectionString: env.DB_URL });
export const db = drizzle(pool, { schema: { stockSchema } });
