import z from "zod";
import { env } from "../env.js";
import type { StockRoot } from "../generated/in/index.js";
import YahooFinance from "yahoo-finance2";
import { dedupe } from "../utils/dedupe.js";
import { HttpError } from "../middleware/httpError.js";

const yf = new YahooFinance();

const SearchTickersResponse = z.object({
  result: z.array(
    z.object({
      description: z.string(),
      symbol: z.string(),
    })
  ),
});

const FinnhubProfileResponse = z
  .object({
    name: z.string().optional(),
    ticker: z.string().optional(),
    exchange: z.string().optional(),
    finnhubIndustry: z.string().optional(),
  })
  .passthrough();

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

const zYahooQuote = z
  .object({
    longname: z.string().optional(),
    shortname: z.string().optional(),
    symbol: z.string(),
    quoteType: z.string().optional(),
    exchange: z.string().optional(),
    exchDisp: z.string().optional(),
    sector: z.string().optional(),
    sectorDisp: z.string().optional(),
    industry: z.string().optional(),
    industryDisp: z.string().optional(),
  })
  .passthrough();

const zYahooSummaryProfile = z
  .object({
    sector: z.string().optional(),
    sectorDisp: z.string().optional(),
    industry: z.string().optional(),
    industryDisp: z.string().optional(),
  })
  .passthrough()
  .optional();

const zYahooPrice = z
  .object({
    exchangeName: z.string().optional(),
    exchange: z.string().optional(),
    longName: z.string().optional(),
    shortName: z.string().optional(),
    symbol: z.string().optional(),
  })
  .passthrough()
  .optional();

const zYahooProfileResult = z
  .object({
    price: zYahooPrice,
    summaryProfile: zYahooSummaryProfile,
    assetProfile: zYahooSummaryProfile,
  })
  .passthrough();

export async function searchTickers(query: string): Promise<StockRoot[]> {
  try {
    const yRes = await yf.search(query, { newsCount: 0 });
    let stocks: StockRoot[] = yRes.quotes
      .map((q): StockRoot | null => {
        const yahooQuote = zYahooQuote.parse(q);
        const ticker = yahooQuote.symbol.split(".")[0];
        if (yahooQuote.quoteType !== "EQUITY" || !ticker) return null;

        return {
          ticker,
          name: firstTextRequired(
            yahooQuote.symbol,
            yahooQuote.longname,
            yahooQuote.shortname,
            yahooQuote.symbol
          ),
          sector: firstText(yahooQuote.sectorDisp, yahooQuote.sector),
          industry: firstText(yahooQuote.industryDisp, yahooQuote.industry),
          exchange: firstText(yahooQuote.exchDisp, yahooQuote.exchange),
        };
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

export async function enrichStockProfile(stock: StockRoot): Promise<StockRoot> {
  const withYahoo = await enrichStockProfileYahoo(stock);
  if (hasCompleteMetadata(withYahoo)) return withYahoo;
  return enrichStockProfileFinnhub(withYahoo);
}

export async function enrichStocksProfiles(
  stocks: StockRoot[]
): Promise<StockRoot[]> {
  return Promise.all(stocks.map(enrichStockProfile));
}

async function enrichStockProfileYahoo(stock: StockRoot): Promise<StockRoot> {
  try {
    const profile = zYahooProfileResult.parse(
      await yf.quoteSummary(stock.ticker, {
        modules: ["price", "summaryProfile", "assetProfile"],
      })
    );
    const summaryProfile = profile.summaryProfile ?? profile.assetProfile;
    const price = profile.price;

    return {
      ...stock,
      name: firstTextRequired(
        stock.name,
        price?.longName,
        price?.shortName,
        stock.name
      ),
      sector: firstText(
        stock.sector,
        summaryProfile?.sectorDisp,
        summaryProfile?.sector
      ),
      industry: firstText(
        stock.industry,
        summaryProfile?.industryDisp,
        summaryProfile?.industry
      ),
      exchange: firstText(stock.exchange, price?.exchangeName, price?.exchange),
    };
  } catch {
    return stock;
  }
}

async function enrichStockProfileFinnhub(stock: StockRoot): Promise<StockRoot> {
  const url = new URL("https://finnhub.io/api/v1/stock/profile2");
  url.searchParams.set("symbol", stock.ticker);
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  try {
    const res = await fetch(url);
    if (!res.ok) return stock;

    const profile = FinnhubProfileResponse.parse(await res.json());
    return {
      ...stock,
      name: firstTextRequired(stock.name, profile.name, stock.name),
      industry: firstText(stock.industry, profile.finnhubIndustry),
      exchange: firstText(stock.exchange, profile.exchange),
    };
  } catch {
    return stock;
  }
}

function hasCompleteMetadata(stock: StockRoot): boolean {
  return !!(stock.name && stock.sector && stock.industry && stock.exchange);
}

function firstText(
  ...values: Array<string | null | undefined>
): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim())
    ?.trim();
}

function firstTextRequired(
  fallback: string,
  ...values: Array<string | null | undefined>
): string {
  return firstText(...values) ?? fallback;
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
