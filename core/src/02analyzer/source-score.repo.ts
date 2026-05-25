import { and, eq, sql, count, gt } from "drizzle-orm";
import { db } from "../postgres.repo.js";
import { sourceScoreSchema } from "./source-score.schema.js";
import type { SourceResultRoot } from "@/generated/in/index.js";

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

export async function listFreshSourceScoresForTicker(
  ticker: string
): Promise<SourceResultRoot[]> {
  const rows = await db
    .select()
    .from(sourceScoreSchema)
    .where(
      and(
        eq(sourceScoreSchema.ticker, ticker),
        gt(
          sourceScoreSchema.scrapedAtSec,
          sql`extract(epoch from now()) - 1 * 60 * 60` // only count sources scraped in the last hour
        )
      )
    );
  return rows.map(rowToSourceResult);
}

export async function countFreshSourceScoresForTicker(
  ticker: string
): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(sourceScoreSchema)
    .where(
      and(
        eq(sourceScoreSchema.ticker, ticker),
        gt(
          sourceScoreSchema.scrapedAtSec,
          sql`extract(epoch from now()) - 1 * 60 * 60` // only count sources scraped in the last hour
        )
      )
    );
  return result[0]?.count ?? 0;
}
