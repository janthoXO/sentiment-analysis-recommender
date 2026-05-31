import { and, eq, inArray, isNull, sql, desc } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { sourceScoreSchema } from "./source-score.schema.js";
import type { SourceResultRoot, SourceRoot } from "../generated/in/index.js";

type PgErrorCause = {
  code?: string;
  column?: string;
};

function rowToSourceResult(
  row: typeof sourceScoreSchema.$inferSelect & { score: number }
): SourceResultRoot {
  return {
    url: row.url,
    title: row.title,
    body: row.body,
    updatedAtSec: row.updatedAtSec,
    scrapedAtSec: row.scrapedAtSec,
    score: row.score,
  };
}

function isScoreNotNullViolation(error: unknown): boolean {
  const cause = (error as { cause?: PgErrorCause }).cause;
  return cause?.code === "23502" && cause.column === "score";
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
  listLatestSourceScoresForTicker(
    ticker: string,
    limit: number
  ): Promise<SourceResultRoot[]>;
  listLatestSourceScoresBefore(
    ticker: string,
    beforeSec: number,
    limit: number
  ): Promise<SourceResultRoot[]>;
}

export function makeSourceScoreRepo(db: Db): SourceScoreRepo {
  async function updateExistingSourceMetadata(
    ticker: string,
    sources: SourceRoot[]
  ) {
    await Promise.all(
      sources.map((s) =>
        db
          .update(sourceScoreSchema)
          .set({
            title: s.title,
            body: s.body,
            updatedAtSec: s.updatedAtSec,
            scrapedAtSec: s.scrapedAtSec,
          })
          .where(
            and(
              eq(sourceScoreSchema.ticker, ticker),
              eq(sourceScoreSchema.url, s.url),
              sql`${s.updatedAtSec} > ${sourceScoreSchema.updatedAtSec}`
            )
          )
      )
    );
  }

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
      try {
        await db
          .insert(sourceScoreSchema)
          .values(
            sources.map((s) => ({
              ticker,
              url: s.url,
              title: s.title,
              body: s.body,
              updatedAtSec: s.updatedAtSec,
              scrapedAtSec: s.scrapedAtSec,
              score: null,
            }))
          )
          .onConflictDoUpdate({
            target: [sourceScoreSchema.ticker, sourceScoreSchema.url],
            set: {
              title: sql`excluded.title`,
              body: sql`excluded.body`,
              updatedAtSec: sql`excluded.updated_at_sec`,
              scrapedAtSec: sql`excluded.scraped_at_sec`,
              score: sql`source_score.score`,
            },
            setWhere: sql`excluded.updated_at_sec > source_score.updated_at_sec`,
          });
      } catch (e) {
        if (!isScoreNotNullViolation(e)) throw e;

        console.warn(
          "source_score.score still has a NOT NULL constraint; metadata insert skipped until migration repairs it"
        );
        await updateExistingSourceMetadata(ticker, sources);
      }
    },

    async upsertSourceScore(ticker, sourceResult) {
      await db
        .insert(sourceScoreSchema)
        .values({
          ticker,
          url: sourceResult.url,
          title: sourceResult.title,
          body: sourceResult.body,
          updatedAtSec: sourceResult.updatedAtSec,
          scrapedAtSec: sourceResult.scrapedAtSec,
          score: sourceResult.score,
        })
        .onConflictDoUpdate({
          target: [sourceScoreSchema.ticker, sourceScoreSchema.url],
          set: {
            score: sql`excluded.score`,
            title: sql`excluded.title`,
            body: sql`excluded.body`,
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
        title: r.title,
        body: r.body,
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

    async listLatestSourceScoresForTicker(ticker, limit) {
      const rows = await db
        .select()
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            sql`${sourceScoreSchema.score} IS NOT NULL`
          )
        )
        .orderBy(desc(sourceScoreSchema.updatedAtSec))
        .limit(limit);
      return (rows as (typeof sourceScoreSchema.$inferSelect)[]).map((r) =>
        rowToSourceResult(r as typeof r & { score: number })
      );
    },

    async listLatestSourceScoresBefore(ticker, beforeSec, limit) {
      const rows = await db
        .select()
        .from(sourceScoreSchema)
        .where(
          and(
            eq(sourceScoreSchema.ticker, ticker),
            sql`${sourceScoreSchema.score} IS NOT NULL`,
            sql`${sourceScoreSchema.updatedAtSec} <= ${beforeSec}`
          )
        )
        .orderBy(desc(sourceScoreSchema.updatedAtSec))
        .limit(limit);
      return (rows as (typeof sourceScoreSchema.$inferSelect)[]).map((r) =>
        rowToSourceResult(r as typeof r & { score: number })
      );
    },
  };
}
