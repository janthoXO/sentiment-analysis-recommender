import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { userTickerAccessSchema } from "./user-ticker-access.schema.js";

export interface UserTickerAccessRepo {
  touch(userId: string, ticker: string, atSec: number): Promise<void>;
  getLastAccessedSec(userId: string, ticker: string): Promise<number | null>;
}

export function makeUserTickerAccessRepo(db: Db): UserTickerAccessRepo {
  return {
    async touch(userId, ticker, atSec) {
      await db
        .insert(userTickerAccessSchema)
        .values({ userId, ticker, lastAccessedSec: atSec })
        .onConflictDoUpdate({
          target: [
            userTickerAccessSchema.userId,
            userTickerAccessSchema.ticker,
          ],
          set: { lastAccessedSec: sql`excluded.last_accessed_sec` },
          setWhere: sql`excluded.last_accessed_sec > user_ticker_access.last_accessed_sec`,
        });
    },

    async getLastAccessedSec(userId, ticker) {
      const rows = await db
        .select({ lastAccessedSec: userTickerAccessSchema.lastAccessedSec })
        .from(userTickerAccessSchema)
        .where(
          and(
            eq(userTickerAccessSchema.userId, userId),
            eq(userTickerAccessSchema.ticker, ticker)
          )
        )
        .limit(1);
      return (
        (rows[0] as { lastAccessedSec: number } | undefined)?.lastAccessedSec ??
        null
      );
    },
  };
}
