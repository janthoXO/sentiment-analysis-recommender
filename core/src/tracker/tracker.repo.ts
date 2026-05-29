import { sql, eq, and } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { trackerSchema } from "./tracker.schema.js";
import type { Tracker } from "./tracker.js";

export interface TrackerRepo {
  upsertTracker(tracker: Tracker): Promise<void>;
  getAllTrackers(): Promise<Tracker[]>;
  getTrackersByPriority(priority: number): Promise<Tracker[]>;
  updateTrackerLastTriggered(
    ticker: string,
    priority: number,
    interval: number,
    lastTriggeredAt: number
  ): Promise<void>;
  deleteTracker(
    ticker: string,
    priority: number,
    interval: number
  ): Promise<void>;
}

export function makeTrackerRepo(db: Db): TrackerRepo {
  return {
    async upsertTracker(tracker) {
      await db
        .insert(trackerSchema)
        .values({
          ticker: tracker.ticker,
          priority: tracker.priority,
          interval: tracker.interval,
          expiresAt: tracker.expiresAt,
          lastTriggeredAt: tracker.lastTriggeredAt ?? null,
        })
        .onConflictDoUpdate({
          target: [
            trackerSchema.ticker,
            trackerSchema.priority,
            trackerSchema.interval,
          ],
          set: {
            expiresAt: sql`GREATEST(${trackerSchema.expiresAt}, EXCLUDED.expires_at)`,
          },
        });
    },

    async getAllTrackers() {
      const result = await db.select().from(trackerSchema);
      return result as Tracker[];
    },

    async getTrackersByPriority(priority) {
      const result = await db
        .select()
        .from(trackerSchema)
        .where(eq(trackerSchema.priority, priority));
      return result as Tracker[];
    },

    async updateTrackerLastTriggered(
      ticker,
      priority,
      interval,
      lastTriggeredAt
    ) {
      await db
        .update(trackerSchema)
        .set({ lastTriggeredAt })
        .where(
          and(
            eq(trackerSchema.ticker, ticker),
            eq(trackerSchema.priority, priority),
            eq(trackerSchema.interval, interval)
          )
        );
    },

    async deleteTracker(ticker, priority, interval) {
      await db
        .delete(trackerSchema)
        .where(
          and(
            eq(trackerSchema.ticker, ticker),
            eq(trackerSchema.priority, priority),
            eq(trackerSchema.interval, interval)
          )
        );
    },
  };
}
