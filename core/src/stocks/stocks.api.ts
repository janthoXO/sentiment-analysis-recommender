import z from "zod";
import { env } from "../env.js";
import type { StockRoot } from "@/generated/in/index.js";
import * as cheerio from "cheerio";

const SearchTickersResponse = z.object({
  result: z.array(
    z.object({
      description: z.string(),
      symbol: z.string(),
    })
  ),
});

export async function searchTickers(query: string): Promise<StockRoot[]> {
  const url = new URL("https://finnhub.io/api/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch Tickers from query");
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

export async function getTopTickers(): Promise<StockRoot[]> {
  return fetchSP500();
}

async function fetchSP500(): Promise<StockRoot[]> {
  const url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

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
  } catch (error) {
    console.error("Failed to fetch S&P 500 data:", error);
    throw error;
  }
}
