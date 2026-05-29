import z from "zod";
import type { StockRoot } from "../generated/in/index.js";
import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { dedupe } from "../utils/dedupe.js";
import { HttpError } from "../middleware/httpError.js";

const yf = new YahooFinance();

const zTrendingResult = z.object({
  quotes: z.array(z.object({ symbol: z.string() })),
});

export async function getTopTickers(): Promise<StockRoot[]> {
  return fetchSP500();
}

export async function getTrendingTickers(
  searchTickers: (query: string) => Promise<StockRoot[]>
): Promise<StockRoot[]> {
  let raw: Awaited<ReturnType<typeof yf.trendingSymbols>>;
  try {
    raw = await yf.trendingSymbols("US", { count: 20 });
  } catch (e) {
    throw HttpError.upstreamUnavailable("Trending feed unavailable", e);
  }

  const parsed = zTrendingResult.parse(raw);
  const symbols = parsed.quotes.map((q) => q.symbol);

  const results: StockRoot[] = [];
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const matches = await searchTickers(symbol);
        const match = matches.find(
          (m) => m.ticker.toUpperCase() === symbol.toUpperCase()
        );
        if (match) results.push(match);
      } catch {
        // skip symbols that fail individual lookup
      }
    })
  );

  return dedupe(results, (s) => s.ticker);
}

async function fetchSP500(): Promise<StockRoot[]> {
  const url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw HttpError.upstreamUnavailable("S&P 500 list unavailable", e);
  }

  if (!response.ok) {
    throw HttpError.upstreamUnavailable(
      `S&P 500 list fetch failed (${response.status})`
    );
  }

  const htmlString = await response.text();
  const $ = cheerio.load(htmlString);
  const constituents: StockRoot[] = [];

  $("#constituents tbody tr").each((index, element) => {
    if (index === 0) return;
    const tds = $(element).find("td");
    if (tds.length >= 7) {
      const ticker = tds.eq(0).text().trim();
      const name = tds.eq(1).text().trim();
      constituents.push({ ticker, name });
    }
  });

  return constituents;
}
