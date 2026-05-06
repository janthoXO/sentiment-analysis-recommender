import { env } from "@/env.js";
import { format, sub } from "date-fns";
import z from "zod";

const zFinnhubNews = z.object({
  headline: z.string(),
  url: z.string(),
  summary: z.string(),
  datetime: z.number(), // in unix timestamp (seconds since epoch)
});

export async function scrape(
  ticker: string
): Promise<
  { url: string; snippet: string; scrapedAtSec: number; updatedAtSec: number }[]
> {
  try {
    const now = new Date();
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${format(sub(now, { days: 1 }), "yyyy-MM-dd")}&to=${format(now, "yyyy-MM-dd")}&token=${env.FINNHUB_KEY}`
    );
    const data = await zFinnhubNews.array().parseAsync(await response.json());

    return data.map((news) => ({
      url: news.url,
      snippet: `${news.headline}\n${news.summary}`,
      scrapedAtSec: Math.floor(now.getTime() / 1000), // convert to seconds since Unix epoch
      updatedAtSec: news.datetime, // already in seconds since Unix epoch
    }));
  } catch (e) {
    console.error(`Scrape failed for ${ticker}:`);
    throw e;
  }
}
