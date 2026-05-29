import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = ReturnType<typeof drizzle<any>>;

export function createDb(
  connectionString: string,
  schema: Record<string, unknown>
): Db {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

export async function runMigrations(
  db: Db,
  migrationsFolder: string
): Promise<void> {
  console.log("⏳ Running migrations...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder });
}
