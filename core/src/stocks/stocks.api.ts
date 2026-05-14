import z from "zod";
import { env } from "../env.js";
import type { StockRoot } from "@/generated/in/index.js";
import * as cheerio from "cheerio";

const SearchTickersResponse = z.object({
  result: z.array(
    z.object({
      description: z.string(), // name
      symbol: z.string(), // ticker until the first dot
    })
  ),
});

export async function searchTickers(
  query: string
): Promise<StockRoot[] | null> {
  const url = new URL("https://finnhub.io/api/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch Tickers from query");
  }
  const data = SearchTickersResponse.parse(await response.json());

  return data.result.map((r) => ({
    ticker: r.symbol.split(".")[0]!, // take the part before the first dot as ticker
    name: r.description,
  }));
}

export async function getTopTickers(): Promise<StockRoot[]> {
  return fetchSP500();
}

async function fetchSP500(): Promise<StockRoot[]> {
  const url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

  try {
    // 1. Native fetch (Requires Node.js 18+)
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const htmlString = await response.text();

    // 2. Load into Cheerio
    const $ = cheerio.load(htmlString);
    const constituents: StockRoot[] = [];

    // 3. Target the main constituents table
    $("#constituents tbody tr").each((index, element) => {
      if (index === 0) return; // Skip the <th> header row

      const tds = $(element).find("td");

      // Ensure the row is valid data
      if (tds.length >= 7) {
        // Column 0: Ticker
        const ticker = tds.eq(0).text().trim();

        // Column 1: Company Name
        const name = tds.eq(1).text().trim();

        constituents.push({
          ticker,
          name,
        });
      }
    });

    return constituents;
  } catch (error) {
    console.error("Failed to fetch S&P 500 data:", error);
    throw error;
  }
}
