import { createHash } from "node:crypto";
import z from "zod";
import { getRedis } from "@/cache.repo.js";
import { env } from "@/env.js";
import type {
  InvestmentInsightRoot,
  SourceResultRoot,
  TickerResultRoot,
} from "@/generated/in/index.js";
import { generateLlmJson, LlmRequestError } from "@/llm/llm-client.js";
import { dedupe } from "@/utils/depupe.js";

const DISCLAIMER =
  "This is not financial advice. It is an educational summary of recent article sentiment.";

const InvestmentInsightSchema = z.object({
  verdict: z.enum(["bullish", "bearish", "neutral", "mixed"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1),
  reasons: z.array(z.string().min(1)).min(1).max(3),
  disclaimer: z.string().min(1),
});

const LlmInsightSchema = z
  .object({
    ticker: z.string(),
    verdict: z.enum(["bullish", "bearish", "neutral", "mixed"]),
    confidence: z.enum(["low", "medium", "high"]),
    summary: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1).max(3),
  })
  .passthrough();

const BatchInsightResponseSchema = z
  .object({
    insights: z.array(LlmInsightSchema),
  })
  .passthrough();

interface InsightPromptTicker {
  ticker: string;
  name: string;
  avgScore: number;
  sources: Array<{
    id: string;
    score: number;
    snippet: string;
  }>;
}

export async function addInvestmentInsights(
  results: TickerResultRoot[]
): Promise<TickerResultRoot[]> {
  if (
    !env.LLM_INSIGHT_ENABLED ||
    env.LLM_PROVIDER === "none" ||
    results.length === 0
  ) {
    return results;
  }

  const cacheEntries = await Promise.all(
    results.map(async (result) => {
      const key = makeInsightCacheKey(result);
      return {
        result,
        key,
        insight: await getCachedInsight(key),
      };
    })
  );

  const missing = cacheEntries
    .filter(
      (entry) => entry.insight === null && entry.result.sources.length > 0
    )
    .map((entry) => entry.result);

  const generated = await generateInsightsInBatches(missing);

  return Promise.all(
    cacheEntries.map(async ({ result, key, insight }) => {
      const resolvedInsight =
        insight ?? generated.get(result.stock.ticker.toUpperCase()) ?? null;
      if (!resolvedInsight) return result;

      if (!insight) {
        await setCachedInsight(key, resolvedInsight);
      }

      return { ...result, investmentInsight: resolvedInsight };
    })
  );
}

async function generateInsightsInBatches(
  results: TickerResultRoot[]
): Promise<Map<string, InvestmentInsightRoot>> {
  const insights = new Map<string, InvestmentInsightRoot>();

  for (let i = 0; i < results.length; i += env.LLM_INSIGHT_BATCH_SIZE) {
    const batch = results.slice(i, i + env.LLM_INSIGHT_BATCH_SIZE);
    if (batch.length === 0) continue;

    const batchInsights = await generateBatchInsights(batch);
    for (const [ticker, insight] of batchInsights) {
      insights.set(ticker, insight);
    }
  }

  return insights;
}

async function generateBatchInsights(
  results: TickerResultRoot[]
): Promise<Map<string, InvestmentInsightRoot>> {
  try {
    const payload = await generateLlmJson({
      prompt: buildInsightPrompt(results),
      maxOutputTokens: Math.min(2048, 384 + results.length * 256),
      temperature: 0.1,
      timeoutMs: env.LLM_INSIGHT_TIMEOUT_MS,
      purpose: "investment insight",
    });
    if (!payload) return new Map();

    const parsed = BatchInsightResponseSchema.safeParse(payload);
    if (!parsed.success) return new Map();

    const insights = new Map<string, InvestmentInsightRoot>();
    for (const rawInsight of parsed.data.insights) {
      const ticker = rawInsight.ticker.trim().toUpperCase();
      const normalized = normalizeInsight(rawInsight);
      if (normalized) insights.set(ticker, normalized);
    }
    return insights;
  } catch (e) {
    if (e instanceof LlmRequestError && e.status === 429) {
      console.warn(
        "LLM investment insight rate-limited (429); returning sentiment scores only"
      );
    } else {
      console.warn(
        "LLM investment insight failed; returning sentiment scores only",
        e
      );
    }
    return new Map();
  }
}

function normalizeInsight(rawInsight: z.infer<typeof LlmInsightSchema>) {
  const parsed = InvestmentInsightSchema.safeParse({
    verdict: rawInsight.verdict,
    confidence: rawInsight.confidence,
    summary: compactText(rawInsight.summary, 320),
    reasons: rawInsight.reasons
      .map((reason) => compactText(reason, 180))
      .filter(Boolean)
      .slice(0, 3),
    disclaimer: DISCLAIMER,
  });

  return parsed.success ? parsed.data : null;
}

async function getCachedInsight(
  key: string
): Promise<InvestmentInsightRoot | null> {
  const data = await getRedis().get(key);
  if (!data) return null;

  try {
    const parsed = InvestmentInsightSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function setCachedInsight(
  key: string,
  insight: InvestmentInsightRoot
): Promise<void> {
  await getRedis().set(
    key,
    JSON.stringify(insight),
    "EX",
    env.CACHE_TTL_INSIGHT_SEC
  );
}

function makeInsightCacheKey(result: TickerResultRoot): string {
  const signature = {
    ticker: result.stock.ticker.toUpperCase(),
    avgScore: roundScore(result.avgScore),
    sources: selectInsightSources(result.sources).map((source) => ({
      urlHash: hashText(source.url),
      score: roundScore(source.score),
      snippetHash: hashText(source.snippet),
    })),
  };

  return `investment-insight:${result.stock.ticker.toUpperCase()}:${hashText(
    JSON.stringify(signature)
  )}`;
}

function buildInsightPrompt(results: TickerResultRoot[]): string {
  const tickers: InsightPromptTicker[] = results.map((result) => ({
    ticker: result.stock.ticker,
    name: result.stock.name,
    avgScore: roundScore(result.avgScore),
    sources: selectInsightSources(result.sources).map((source, index) => ({
      id: `${result.stock.ticker}-${index + 1}`,
      score: roundScore(source.score),
      snippet: compactText(source.snippet, 360),
    })),
  }));

  return [
    "Explain existing stock-news sentiment scores for a demo UI.",
    "Use only the provided scored sources. Do not use outside knowledge.",
    "Do not recommend buying, selling, holding, shorting, or trading. Do not claim certainty.",
    "Summaries must describe the recent article narrative behind the score, not predict future returns.",
    "Return only JSON with this exact shape:",
    '{"insights":[{"ticker":"AAPL","verdict":"mixed","confidence":"medium","summary":"One or two sentences.","reasons":["Grounded reason","Grounded reason"]}]}',
    "Allowed verdict values: bullish, bearish, neutral, mixed.",
    "Allowed confidence values: low, medium, high.",
    "Each ticker needs 1-2 summary sentences and 2-3 short reasons grounded in the source snippets and scores.",
    `Tickers: ${JSON.stringify(tickers)}`,
  ].join("\n");
}

function selectInsightSources(sources: SourceResultRoot[]): SourceResultRoot[] {
  const recent = [...sources].sort((a, b) => b.updatedAtSec - a.updatedAtSec);
  const positive = sources
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score);
  const negative = sources
    .filter((source) => source.score < 0)
    .sort((a, b) => a.score - b.score);
  const strongest = [...sources].sort(
    (a, b) => Math.abs(b.score) - Math.abs(a.score)
  );

  return dedupe(
    [
      ...positive.slice(0, 2),
      ...negative.slice(0, 2),
      ...recent.slice(0, 2),
      ...strongest,
    ],
    (source) => source.url
  ).slice(0, env.LLM_INSIGHT_MAX_ARTICLES);
}

function compactText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength - 1).trim()}...`;
}

function roundScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}
