import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.js";
import * as schema from "./postgres.schema.js";
import { eq } from "drizzle-orm";
const pool = new pg.Pool({ connectionString: env.POSTGRES_URL });
export const db = drizzle(pool, { schema });
export async function saveArticle({ scanJobId, ticker, url, snippet, score, }) {
    await db.insert(schema.articles).values({
        scanJobId,
        ticker,
        url,
        snippet,
        score: score !== null ? score.toString() : null,
    });
}
export async function upsertScore({ ticker, avgScore, articleCount, }) {
    await db
        .insert(schema.stockScores)
        .values({
        ticker,
        avgScore: avgScore !== null ? avgScore.toString() : null,
        articleCount,
    })
        .onConflictDoUpdate({
        target: schema.stockScores.ticker,
        set: {
            avgScore: avgScore !== null ? avgScore.toString() : null,
            articleCount,
            computedAt: new Date(),
        },
    });
}
export async function getStock(ticker) {
    const res = await db
        .select()
        .from(schema.stocks)
        .where(eq(schema.stocks.ticker, ticker))
        .limit(1);
    return res[0] || null;
}
export async function saveStock(stock) {
    await db.insert(schema.stocks).values(stock).onConflictDoNothing();
}
//# sourceMappingURL=postgres.repo.js.map