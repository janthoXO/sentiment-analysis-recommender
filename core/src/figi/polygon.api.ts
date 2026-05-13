import z from "zod";
import { env } from "../env.js";
import type { StockRoot } from "@/generated/in/index.js";

const PolygonResponse = z.object({
  results: z
    .array(
      z.object({
        ticker: z.string(),
        share_class_figi: z.string().optional(),
        name: z.string(),
      })
    )
    .optional(),
});

export async function searchTickers(
  query: string
): Promise<StockRoot[] | null> {
  const url = `https://api.polygon.io/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&limit=10&apiKey=${env.POLYGON_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch from Polygon API");
  }
  const data = PolygonResponse.parse(await response.json());

  if (!data.results) {
    return null;
  }

  return data.results.map((r) => ({
    ticker: r.ticker,
    figi: r.share_class_figi || `BBG000${r.ticker}`,
    name: r.name,
  }));
}
