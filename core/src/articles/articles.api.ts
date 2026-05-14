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

export async function getArticlesByTicker(ticker: string): Promise<Root[]> {
  try {
    let articles: Root[] = [];
    const now = new Date();

    // incrementally go back in time until we have at least 5 articles or 32 days reached
    for (let i = 0; articles.length < MIN_ARTICLES && i < 6; i++) {
      const url = new URL("https://finnhub.io/api/v1/company-news");
      url.searchParams.set("symbol", ticker);
      url.searchParams.set(
        "from",
        format(sub(now, { days: 2 ** i }), "yyyy-MM-dd")
      );
      url.searchParams.set("to", format(now, "yyyy-MM-dd"));
      url.searchParams.set("token", env.FINNHUB_API_KEY);
      const response = await fetch(url);
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
    console.error(`Failed to fetch articles for ${ticker}:`);
    throw e;
  }
}
