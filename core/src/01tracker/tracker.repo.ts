import { db } from "../postgres.repo.js";
import { trackerSchema } from "./tracker.schema.js";
import type { Tracker } from "./tracker.js";
import { sql, eq, and } from "drizzle-orm";

export async function upsertTracker(tracker: Tracker) {
  await db
    .insert(trackerSchema)
    .values({
      ticker: tracker.ticker,
      name: tracker.name,
      priority: tracker.priority,
      interval: tracker.interval,
      expiresAt: tracker.expiresAt,
      lastTriggeredAt: tracker.lastTriggeredAt,
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
}

export async function getAllTrackers(): Promise<Tracker[]> {
  const result = await db.select().from(trackerSchema);
  return result;
}

export async function updateTrackerLastTriggered(
  ticker: string,
  priority: number,
  interval: number,
  lastTriggeredAt: number
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
}

export async function deleteTracker(
  ticker: string,
  priority: number,
  interval: number
) {
  await db
    .delete(trackerSchema)
    .where(
      and(
        eq(trackerSchema.ticker, ticker),
        eq(trackerSchema.priority, priority),
        eq(trackerSchema.interval, interval)
      )
    );
}
