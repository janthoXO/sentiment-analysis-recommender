import z from "zod";
import { env } from "../env.js";
import type { StockRoot } from "@/generated/in/index.js";
import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { dedupe } from "@/utils/depupe.js";
import { HttpError } from "@/middleware/httpError.js";

const yf = new YahooFinance();

const SearchTickersResponse = z.object({
  result: z.array(
    z.object({
      description: z.string(),
      symbol: z.string(),
    })
  ),
});

async function searchTickersFinnhub(query: string): Promise<StockRoot[]> {
  const url = new URL("https://finnhub.io/api/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw HttpError.upstreamUnavailable("Stock search unavailable", e);
  }

  if (response.status === 429 || response.status >= 500) {
    throw HttpError.upstreamUnavailable(
      `Stock search rate-limited or unavailable (${response.status})`
    );
  }
  if (!response.ok) {
    throw HttpError.upstreamUnavailable(
      `Stock search failed (${response.status})`
    );
  }

  const data = SearchTickersResponse.parse(await response.json());

  const tickerSet: Record<string, StockRoot> = {};
  data.result
    .map((r) => ({
      ticker: r.symbol.split(".")[0]!,
      name: r.description,
    }))
    .forEach((t) => {
      tickerSet[t.ticker] = t;
    });

  return Object.values(tickerSet);
}

const zYahooQuote = z.looseObject({
  longname: z.string(),
  shortname: z.string(),
  symbol: z.string(),
  quoteType: z.string().optional(),
});

export async function searchTickers(query: string): Promise<StockRoot[]> {
  try {
    const yRes = await yf.search(query, { newsCount: 0 });
    let stocks: StockRoot[] = yRes.quotes
      .map((q) => {
        const yahooQuote = zYahooQuote.parse(q);
        return yahooQuote.quoteType === "EQUITY"
          ? {
              ticker: yahooQuote.symbol.split(".")[0],
              name:
                yahooQuote.longname ??
                yahooQuote.shortname ??
                yahooQuote.symbol,
            }
          : null;
      })
      .filter((q): q is StockRoot => !!q);
    stocks = dedupe(stocks, (s) => s.ticker);

    if (stocks.length > 0) {
      return stocks;
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // Yahoo failed — fall through to Finnhub
  }

  return searchTickersFinnhub(query);
}

const zPeersResponse = z.array(z.string());

async function fetchFinnhubPeers(ticker: string): Promise<string[]> {
  const url = `https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(ticker)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY },
    });
  } catch (e) {
    throw HttpError.upstreamUnavailable("Peer lookup unavailable", e);
  }

  if (res.status === 429 || res.status >= 500) {
    throw HttpError.upstreamUnavailable(
      `Peer lookup rate-limited or unavailable (${res.status})`
    );
  }
  if (!res.ok) {
    throw HttpError.upstreamUnavailable(`Peer lookup failed (${res.status})`);
  }

  const parsed = zPeersResponse.parse(await res.json());
  const upper = ticker.toUpperCase();
  return Array.from(
    new Set(
      parsed.map((t) => t.toUpperCase().trim()).filter((t) => t && t !== upper)
    )
  );
}

export async function getCompanyPeers(ticker: string): Promise<string[]> {
  let finnhubPeers: string[] = [];
  try {
    finnhubPeers = await fetchFinnhubPeers(ticker);
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) {
      // Finnhub unavailable — try Yahoo fallback below
    } else {
      throw e;
    }
  }
  if (finnhubPeers.length > 0) return finnhubPeers;

  // Yahoo fallback for non-US tickers where Finnhub returns nothing.
  try {
    const rec = await yf.recommendationsBySymbol(ticker);
    const upper = ticker.toUpperCase();

    return dedupe(
      rec.recommendedSymbols
        .map((r) => r.symbol.split(".")[0]!.toUpperCase())
        .filter((s) => s && s !== upper),
      (s) => s
    );
  } catch {
    return [];
  }
}

export async function getTopTickers(): Promise<StockRoot[]> {
  return fetchSP500();
}

const zTrendingResult = z.object({
  quotes: z.array(z.object({ symbol: z.string() })),
});

export async function getTrendingTickers(): Promise<StockRoot[]> {
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
