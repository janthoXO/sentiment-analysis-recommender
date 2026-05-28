import z from "zod";
import type { StockRoot } from "@/generated/in/index.js";
import { env } from "@/env.js";
import { searchTickers } from "@/stocks/stocks.api.js";
import { dedupe } from "@/utils/depupe.js";

const GeminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(
                  z
                    .object({
                      text: z.string().optional(),
                    })
                    .passthrough()
                ),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const ThemeQueryResponseSchema = z
  .object({
    confidence: z.coerce.number().min(0).max(1),
    tickers: z.array(
      z
        .object({
          ticker: z.string(),
          reason: z.string().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

type ThemeQueryResponse = z.infer<typeof ThemeQueryResponseSchema>;

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const KNOWN_THEME_TICKERS: Record<string, string[]> = {
  "grand theft auto": ["TTWO"],
  gta: ["TTWO"],
  "rockstar games": ["TTWO"],
  "toy story": ["DIS"],
  pixar: ["DIS"],
  alexa: ["AMZN"],
  "universal pictures": ["CMCSA"],
  playstation: ["SONY"],
  "call of duty": ["MSFT"],
  cars: ["TSLA", "TM", "F", "GM", "STLA"],
  autos: ["TSLA", "TM", "F", "GM", "STLA"],
  automakers: ["TSLA", "TM", "F", "GM", "STLA"],
  automotive: ["TSLA", "TM", "F", "GM", "STLA"],
  "car makers": ["TSLA", "TM", "F", "GM", "STLA"],
  "electric cars": ["TSLA", "RIVN", "LCID", "GM", "F"],
  "cars movie": ["DIS"],
  "pixar cars": ["DIS"],
  trucks: ["F", "GM", "PCAR"],
  "wood products": ["WY", "LPX", "UFPI"],
  movies: ["DIS", "CMCSA", "SONY", "NFLX", "WBD"],
  videogames: ["TTWO", "EA", "RBLX", "NTDOY", "SONY"],
};

class GeminiRequestError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(
      `Gemini request failed (${status}${statusText ? ` ${statusText}` : ""})`
    );
    this.name = "GeminiRequestError";
  }
}

export function isExplicitTickerQuery(query: string): boolean {
  const trimmed = query.trim();
  return (
    trimmed.length > 0 &&
    trimmed === trimmed.toUpperCase() &&
    TICKER_PATTERN.test(trimmed)
  );
}

export async function resolveThemeQueryStocks(
  query: string
): Promise<StockRoot[] | null> {
  const knownThemeStocks = await resolveKnownThemeStocks(query);
  if (knownThemeStocks) return knownThemeStocks;

  if (env.LLM_PROVIDER !== "gemini") return null;

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("LLM_PROVIDER=gemini but GEMINI_API_KEY is not configured");
    return null;
  }

  try {
    const themeResponse = await requestGeminiThemeTickers(query, apiKey);
    if (
      !themeResponse ||
      themeResponse.confidence < env.LLM_THEME_CONFIDENCE_THRESHOLD
    ) {
      return null;
    }

    const tickers = dedupe(
      themeResponse.tickers
        .map((item) => normalizeTicker(item.ticker))
        .filter((ticker): ticker is string => ticker !== null)
        .slice(0, env.LLM_THEME_MAX_TICKERS),
      (ticker) => ticker
    );
    if (tickers.length === 0) return null;

    const validStocks = await validateTickers(tickers);

    return validStocks.length > 0 ? validStocks : null;
  } catch (e) {
    if (e instanceof GeminiRequestError && e.status === 429) {
      console.warn(
        "Gemini theme query rate-limited (429); falling back to ticker search"
      );
    } else {
      console.warn(
        "Gemini theme query failed; falling back to ticker search",
        e
      );
    }
    return null;
  }
}

async function resolveKnownThemeStocks(
  query: string
): Promise<StockRoot[] | null> {
  const tickers = KNOWN_THEME_TICKERS[normalizeThemeAliasKey(query)];
  if (!tickers) return null;

  const stocks = await validateTickers(tickers);
  return stocks.length > 0 ? stocks : null;
}

async function requestGeminiThemeTickers(
  query: string,
  apiKey: string
): Promise<ThemeQueryResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const model = env.LLM_MODEL.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildThemeQueryPrompt(query) }],
          },
        ],
        generationConfig: {
          candidateCount: 1,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GeminiRequestError(response.status, response.statusText);
    }

    const payload = GeminiResponseSchema.parse(await response.json());
    const text =
      payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .filter((part): part is string => typeof part === "string")
        .join("")
        .trim() ?? "";

    if (!text) return null;

    const parsed = ThemeQueryResponseSchema.safeParse(parseJsonObject(text));
    return parsed.success ? parsed.data : null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildThemeQueryPrompt(query: string): string {
  return [
    "Map a user's stock search query to relevant publicly traded equity tickers.",
    "Return only JSON with this shape:",
    '{"confidence":0.0,"tickers":[{"ticker":"NVDA","reason":"AI accelerator leader"}]}',
    `Return at most ${env.LLM_THEME_MAX_TICKERS} tickers. Prefer US-listed common stocks. Do not include ETFs, indexes, crypto, or private companies. Do not invent symbols.`,
    "Treat user queries case-insensitively. Capitalization may be noisy and must not change the mapping.",
    "The user query may be a sector, theme, product, brand, franchise, movie, video game, sports team, league, material, vehicle type, or consumer category.",
    "If the query names a product, brand, franchise, subsidiary, or entertainment IP, map it to the publicly traded parent company when one exists.",
    "If the query names a sports team or league, map it to a publicly traded owner, media-rights company, sponsor, or directly exposed sports business only when the link is strong.",
    "For broad categories, return a small diversified set of direct public-company exposures, not obscure or loosely related tickers.",
    "Use confidence near 1 for well-known direct mappings, 0.6-0.8 for broad themes, and below 0.6 when the stock mapping is weak or ambiguous.",
    "Example mappings:",
    'Query: "Grand Theft Auto" -> TTWO',
    'Query: "Grand theft auto" -> TTWO',
    'Query: "grand theft auto" -> TTWO',
    'Query: "Rockstar Games" -> TTWO',
    'Query: "Toy Story" -> DIS',
    'Query: "toy story" -> DIS',
    'Query: "Pixar" -> DIS',
    'Query: "Alexa" -> AMZN',
    'Query: "Universal Pictures" -> CMCSA',
    'Query: "PlayStation" -> SONY',
    'Query: "Call of Duty" -> MSFT',
    'Query: "cars" -> TSLA, TM, F, GM, STLA',
    'Query: "automotive" -> TSLA, TM, F, GM, STLA',
    'Query: "electric cars" -> TSLA, RIVN, LCID, GM, F',
    'Query: "Cars movie" -> DIS',
    'Query: "trucks" -> F, GM, PCAR',
    'Query: "wood products" -> WY, LPX, UFPI',
    'Query: "movies" -> DIS, CMCSA, SONY, NFLX, WBD',
    'Query: "videogames" -> TTWO, EA, RBLX, NTDOY, SONY',
    "If there is no meaningful public-equity mapping, return confidence 0 and an empty tickers array.",
    `User query: ${JSON.stringify(query)}`,
  ].join("\n");
}

function parseJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Gemini response did not contain valid JSON");
  }
}

function normalizeTicker(ticker: string): string | null {
  const normalized = ticker.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_PATTERN.test(normalized) ? normalized : null;
}

function normalizeThemeAliasKey(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function validateTickers(tickers: string[]): Promise<StockRoot[]> {
  const stocks = await Promise.all(tickers.map(validateTicker));
  return dedupe(
    stocks.filter((stock): stock is StockRoot => stock !== null),
    (stock) => stock.ticker.toUpperCase()
  );
}

async function validateTicker(ticker: string): Promise<StockRoot | null> {
  try {
    const matches = await searchTickers(ticker);
    return (
      matches.find((stock) => stock.ticker.toUpperCase() === ticker) ?? null
    );
  } catch (e) {
    console.warn(`Could not validate LLM ticker ${ticker}`, e);
    return null;
  }
}
