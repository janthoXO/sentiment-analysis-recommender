import { env } from "@/env.js";
import type { Root } from "@/generated/in/index.js";
import { format, sub } from "date-fns";
import z from "zod";

const MIN_ARTICLES = 5;
const TOP_X_ARTICLES = 10;

const zFinnhubNews = z.object({
  headline: z.string(),
  url: z.string(),
  summary: z.string(),
  datetime: z.number(), // in unix timestamp (seconds since epoch)
});

export async function scrape(ticker: string): Promise<Root[]> {
  try {
    let articles: Root[] = [];
    const now = new Date();

    // incrementally go back in time until we have at least 5 articles or 32 days reached
    for (let i = 0; articles.length < MIN_ARTICLES && i < 6; i++) {
      const response = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${format(sub(now, { days: 2 ** i }), "yyyy-MM-dd")}&to=${format(now, "yyyy-MM-dd")}&token=${env.FINNHUB_KEY}`
      );
      const data = await zFinnhubNews.array().parseAsync(await response.json());

      articles = data.map((news) => ({
        url: news.url,
        snippet: `${news.headline}\n${news.summary}`,
        scrapedAtSec: Math.floor(now.getTime() / 1000), // convert to seconds since Unix epoch
        updatedAtSec: news.datetime, // already in seconds since Unix epoch
      }));
    }

    // only keep top X articles
    return articles.slice(0, TOP_X_ARTICLES);
  } catch (e) {
    console.error(`Scrape failed for ${ticker}:`);
    throw e;
  }
}
