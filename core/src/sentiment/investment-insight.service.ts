import { createHash } from "node:crypto";
import z from "zod";

import { env } from "@/env.js";
import type {
  InvestmentInsightRoot,
  SourceResultRoot,
  StockRoot,
} from "@/generated/in/index.js";
import {
  generateStructuredLlmObject,
  LlmRateLimitError,
} from "@/llm/llm-client.js";
import { dedupe } from "@/utils/dedupe.js";
import type { RedisClient } from "@/utils/cache.repo.js";
import type { SourceScoreRepo } from "./source-score.repo.js";

const DISCLAIMER =
  "This is not financial advice. It is an educational summary of recent article sentiment.";

const LlmInsightSchema = z
  .object({
    verdict: z.enum(["bullish", "bearish", "neutral", "mixed"]),
    confidence: z.enum(["low", "medium", "high"]),
    summary: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1).max(3),
  })
  .passthrough();

const InvestmentInsightSchema = z.object({
  verdict: z.enum(["bullish", "bearish", "neutral", "mixed"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1),
  reasons: z.array(z.string().min(1)).min(1).max(3),
  disclaimer: z.string().min(1),
});

export interface InvestmentInsightService {
  getInvestmentInsight(
    stock: StockRoot,
    articleUrls: string[]
  ): Promise<InvestmentInsightRoot | null>;
}

export function makeInvestmentInsightService({
  redis,
  sourceScoreRepo,
}: {
  redis: RedisClient;
  sourceScoreRepo: SourceScoreRepo;
}): InvestmentInsightService {
  async function getCachedInsight(
    key: string
  ): Promise<InvestmentInsightRoot | null> {
    const data = await redis.get(key);
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
    await redis.set(
      key,
      JSON.stringify(insight),
      "EX",
      env.CACHE_TTL_INSIGHT_SEC
    );
  }

  return {
    async getInvestmentInsight(stock, articleUrls) {
      if (env.LLM_PROVIDER === "none" || articleUrls.length === 0) {
        return null;
      }

      const sources = await sourceScoreRepo.listSourceScoresByUrls(
        stock.ticker,
        articleUrls
      );
      if (sources.length === 0) return null;

      const key = makeInsightCacheKey(stock, sources);
      const cached = await getCachedInsight(key);
      if (cached) return cached;

      const generated = await generateInsight(stock, sources);
      if (!generated) return null;

      await setCachedInsight(key, generated);
      return generated;
    },
  };
}

async function generateInsight(
  stock: StockRoot,
  sources: SourceResultRoot[]
): Promise<InvestmentInsightRoot | null> {
  try {
    const rawInsight = await generateStructuredLlmObject({
      prompt: buildInsightPrompt(stock, sources),
      schema: LlmInsightSchema,
      schemaName: "investment_sentiment_insight",
      schemaDescription:
        "Explains the recent scored article sentiment for one ticker.",
      maxOutputTokens: 768,
      temperature: 0.1,
      timeoutMs: env.LLM_INSIGHT_TIMEOUT_MS,
    });

    return rawInsight ? normalizeInsight(rawInsight) : null;
  } catch (e) {
    if (e instanceof LlmRateLimitError) {
      console.warn(
        "LLM investment insight rate-limited (429); returning sentiment scores only"
      );
    } else {
      console.warn(
        "LLM investment insight failed; returning sentiment scores only",
        e
      );
    }
    return null;
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

function makeInsightCacheKey(
  stock: StockRoot,
  sources: SourceResultRoot[]
): string {
  const signature = {
    ticker: stock.ticker.toUpperCase(),
    avgScore: roundScore(avgScore(sources)),
    sources: selectInsightSources(sources).map((source) => ({
      urlHash: hashText(source.url),
      score: roundScore(source.score),
      snippetHash: hashText(source.snippet),
    })),
  };

  return `investment-insight:${stock.ticker.toUpperCase()}:${hashText(
    JSON.stringify(signature)
  )}`;
}

function buildInsightPrompt(
  stock: StockRoot,
  sources: SourceResultRoot[]
): string {
  const selectedSources = selectInsightSources(sources).map(
    (source, index) => ({
      id: `${stock.ticker}-${index + 1}`,
      score: roundScore(source.score),
      snippet: compactText(source.snippet, 360),
    })
  );

  const tickerPayload = {
    ticker: stock.ticker,
    name: stock.name,
    avgScore: roundScore(avgScore(sources)),
    sources: selectedSources,
  };

  return [
    "Explain existing stock-news sentiment scores for a demo UI.",
    "Use only the provided scored sources. Do not use outside knowledge.",
    "Do not recommend buying, selling, holding, shorting, or trading. Do not claim certainty.",
    "Summaries must describe the recent article narrative behind the score, not predict future returns.",
    "Return only JSON with this exact shape:",
    '{"verdict":"mixed","confidence":"medium","summary":"One or two sentences.","reasons":["Grounded reason","Grounded reason"]}',
    "Allowed verdict values: bullish, bearish, neutral, mixed.",
    "Allowed confidence values: low, medium, high.",
    "Use 1-2 summary sentences and 2-3 short reasons grounded in the source snippets and scores.",
    `Ticker: ${JSON.stringify(tickerPayload)}`,
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

function avgScore(sources: SourceResultRoot[]): number {
  if (sources.length === 0) return 0;
  return (
    sources.reduce((sum, source) => sum + source.score, 0) / sources.length
  );
}

function roundScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}
