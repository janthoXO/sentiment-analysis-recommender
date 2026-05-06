import { env } from "@/env.js";
import z from "zod";

const zFinnhubNews = z.object({
  headline: z.string(),
  url: z.string(),
  summary: z.string(),
});

export async function scrape(
  ticker: string
): Promise<{ url: string; snippet: string }[]> {
  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=2025-05-15&to=2025-06-20&token=${env.FINNHUB_KEY}`
    );
    const data = await zFinnhubNews.array().parseAsync(await response.json());

    return data.map((news) => ({
      url: news.url,
      snippet: `${news.headline}\n${news.summary}`,
    }));
  } catch (e) {
    console.error(`Scrape failed for ${ticker}:`);
    throw e;
  }
}
