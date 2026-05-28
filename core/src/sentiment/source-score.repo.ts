import { and, between, eq, inArray, isNull, sql, count } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { sourceScoreSchema } from "./source-score.schema.js";
import type { SourceResultRoot, SourceRoot } from "../generated/in/index.js";
import { getUnixTime } from "date-fns";

function rowToSourceResult(
  row: typeof sourceScoreSchema.$inferSelect & { score: number }
): SourceResultRoot {
  return {
    url: row.url,
    snippet: row.snippet,
    updatedAtSec: row.updatedAtSec,
    scrapedAtSec: row.scrapedAtSec,
    score: row.score,
  };
}

export interface FreshWindow {
  toSec?: number;
  intervalSec?: number;
}

export interface SourceScoreRepo {
  getSourceScore(ticker: string, url: string): Promise<SourceResultRoot | null>;
  upsertManySourceMetadata(
    ticker: string,
    sources: SourceRoot[]
  ): Promise<void>;
  upsertSourceScore(
    ticker: string,
    sourceResult: SourceResultRoot
  ): Promise<void>;
  upsertManySourceScores(
    ticker: string,
    results: SourceResultRoot[]
  ): Promise<void>;
  listSourcesByUrls(ticker: string, urls: string[]): Promise<SourceRoot[]>;
  listSourceScoresByUrls(
    ticker: string,
    urls: string[]
  ): Promise<SourceResultRoot[]>;
  listMissingScoreUrls(ticker: string, urls: string[]): Promise<string[]>;
  listFreshSourceScoresForTicker(
    ticker: string,
    win?: FreshWindow
  ): Promise<SourceResultRoot[]>;
  countFreshSourceScoresForTicker(
    ticker: string,
    win?: FreshWindow
  ): Promise<number>;
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
    intervalSec = 86_400;
  } else {
    intervalSec = 3_600;
  }
  return { fromSec: toSec - intervalSec, toSec };
}

export function makeSourceScoreRepo(db: Db): SourceScoreRepo {
  return {
    async getSourceScore(ticker, url) {
      const rows = await db
        .select()
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            eq(sourceScoreSchema.url, url)
          )
        )
        .limit(1);
      const row = rows[0] as typeof sourceScoreSchema.$inferSelect | undefined;
      if (!row || row.score == null) return null;
      return rowToSourceResult(row as typeof row & { score: number });
    },

    async upsertManySourceMetadata(ticker, sources) {
      if (sources.length === 0) return;
      await db
        .insert(sourceScoreSchema)
        .values(
          sources.map((s) => ({
            ticker,
            url: s.url,
            snippet: s.snippet,
            updatedAtSec: s.updatedAtSec,
            scrapedAtSec: s.scrapedAtSec,
            score: null,
          }))
        )
        .onConflictDoUpdate({
          target: [sourceScoreSchema.ticker, sourceScoreSchema.url],
          set: {
            snippet: sql`excluded.snippet`,
            updatedAtSec: sql`excluded.updated_at_sec`,
            scrapedAtSec: sql`excluded.scraped_at_sec`,
            score: sql`source_score.score`,
          },
          setWhere: sql`excluded.updated_at_sec > source_score.updated_at_sec`,
        });
    },

    async upsertSourceScore(ticker, sourceResult) {
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
    },

    async upsertManySourceScores(ticker, results) {
      if (results.length === 0) return;
      await Promise.all(results.map((r) => this.upsertSourceScore(ticker, r)));
    },

    async listSourcesByUrls(ticker, urls) {
      if (urls.length === 0) return [];
      const rows = await db
        .select()
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            inArray(sourceScoreSchema.url, urls)
          )
        );
      return (rows as (typeof sourceScoreSchema.$inferSelect)[]).map((r) => ({
        url: r.url,
        snippet: r.snippet,
        updatedAtSec: r.updatedAtSec,
        scrapedAtSec: r.scrapedAtSec,
      }));
    },

    async listSourceScoresByUrls(ticker, urls) {
      if (urls.length === 0) return [];
      const rows = await db
        .select()
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            inArray(sourceScoreSchema.url, urls)
          )
        );
      return (rows as (typeof sourceScoreSchema.$inferSelect)[])
        .filter((r) => r.score != null)
        .map((r) => rowToSourceResult(r as typeof r & { score: number }));
    },

    async listMissingScoreUrls(ticker, urls) {
      if (urls.length === 0) return [];
      const nullRows = await db
        .select({ url: sourceScoreSchema.url })
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            inArray(sourceScoreSchema.url, urls),
            isNull(sourceScoreSchema.score)
          )
        );
      const scoredOrNull = new Set(nullRows.map((r) => r.url));
      const allDbRows = await db
        .select({ url: sourceScoreSchema.url })
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            inArray(sourceScoreSchema.url, urls)
          )
        );
      const inDb = new Set(allDbRows.map((r) => r.url));
      return urls.filter((u) => scoredOrNull.has(u) || !inDb.has(u));
    },

    async listFreshSourceScoresForTicker(ticker, win) {
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
      return (rows as (typeof sourceScoreSchema.$inferSelect)[])
        .filter((r) => r.score != null)
        .map((r) => rowToSourceResult(r as typeof r & { score: number }));
    },

    async countFreshSourceScoresForTicker(ticker, win) {
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
      return (result[0] as { count: number } | undefined)?.count ?? 0;
    },
  };
}
