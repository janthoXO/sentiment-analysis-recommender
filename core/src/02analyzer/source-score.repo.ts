import { and, between, eq, sql, count } from "drizzle-orm";
import { db } from "../postgres.repo.js";
import { sourceScoreSchema } from "./source-score.schema.js";
import type { SourceResultRoot } from "@/generated/in/index.js";
import { getUnixTime } from "date-fns";

function rowToSourceResult(
  row: typeof sourceScoreSchema.$inferSelect
): SourceResultRoot {
  return {
    url: row.url,
    snippet: row.snippet,
    updatedAtSec: row.updatedAtSec,
    scrapedAtSec: row.scrapedAtSec,
    score: row.score,
  };
}

export async function getSourceScore(
  ticker: string,
  url: string
): Promise<SourceResultRoot | null> {
  const rows = await db
    .select()
    .from(sourceScoreSchema)
    .where(
      and(eq(sourceScoreSchema.ticker, ticker), eq(sourceScoreSchema.url, url))
    )
    .limit(1);
  return rows[0] ? rowToSourceResult(rows[0]) : null;
}

export async function upsertSourceScore(
  ticker: string,
  sourceResult: SourceResultRoot
): Promise<void> {
  await db
    .insert(sourceScoreSchema)
    .values({
      ticker,
      url: sourceResult.url,
      snippet: sourceResult.snippet,
      updatedAtSec: sourceResult.updatedAtSec,
      scrapedAtSec: sourceResult.scrapedAtSec,
      score: sourceResult.score,
    })
    .onConflictDoUpdate({
      target: [sourceScoreSchema.ticker, sourceScoreSchema.url],
      set: {
        score: sql`excluded.score`,
        snippet: sql`excluded.snippet`,
        updatedAtSec: sql`excluded.updated_at_sec`,
        scrapedAtSec: sql`excluded.scraped_at_sec`,
      },
      setWhere: sql`excluded.updated_at_sec > source_score.updated_at_sec`,
    });
}

export async function upsertManySourceScores(
  ticker: string,
  results: SourceResultRoot[]
): Promise<void> {
  if (results.length === 0) return;
  await Promise.all(results.map((r) => upsertSourceScore(ticker, r)));
}

export interface FreshWindow {
  /** Upper bound (Unix seconds). Defaults to now. */
  toSec?: number;
  /** Window size in seconds.
   *  - toSec + intervalSec → [toSec - intervalSec, toSec]
   *  - toSec only          → [toSec - 86400, toSec]
   *  - intervalSec only    → [now - intervalSec, now]
   *  - neither             → [now - 3600, now]  (preserves old 1-hour default)
   */
  intervalSec?: number;
}

function resolveFreshWindow(win?: FreshWindow): {
  fromSec: number;
  toSec: number;
} {
  const nowSec = getUnixTime(new Date());
  const toSec = win?.toSec ?? nowSec;

  let intervalSec: number;
  if (win?.intervalSec !== undefined) {
    intervalSec = win.intervalSec;
  } else if (win?.toSec !== undefined) {
    intervalSec = 86_400; // default 1-day window when toSec is explicitly given
  } else {
    intervalSec = 3_600; // default 1-hour window (preserve old behavior)
  }

  return { fromSec: toSec - intervalSec, toSec };
}

export async function listFreshSourceScoresForTicker(
  ticker: string,
  win?: FreshWindow
): Promise<SourceResultRoot[]> {
  const { fromSec, toSec } = resolveFreshWindow(win);
  const rows = await db
    .select()
    .from(sourceScoreSchema)
    .where(
      and(
        eq(sourceScoreSchema.ticker, ticker),
        between(sourceScoreSchema.updatedAtSec, fromSec, toSec)
      )
    );
  return rows.map(rowToSourceResult);
}

export async function countFreshSourceScoresForTicker(
  ticker: string,
  win?: FreshWindow
): Promise<number> {
  const { fromSec, toSec } = resolveFreshWindow(win);
  const result = await db
    .select({ count: count() })
    .from(sourceScoreSchema)
    .where(
      and(
        eq(sourceScoreSchema.ticker, ticker),
        between(sourceScoreSchema.updatedAtSec, fromSec, toSec)
      )
    );
  return result[0]?.count ?? 0;
}
