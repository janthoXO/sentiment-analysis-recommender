import axios from "axios";
import * as cheerio from "cheerio";

const MAX_ARTICLES = 10;

export async function scrape(
  ticker: string
): Promise<{ url: string; snippet: string }[]> {
  try {
    const response = await axios.get(
      `https://finance.yahoo.com/quote/${ticker}/news/`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
        },
      }
    );

    const $ = cheerio.load(response.data);
    const articles: { url: string; snippet: string }[] = [];

    $("h3").each((_i, el) => {
      if (articles.length >= MAX_ARTICLES) return;
      const _url = $(el).parent().attr("href") || $(el).find("a").attr("href");
      if (_url) {
        // naive snippet extraction
        const p = $(el).parent().next("p").text();
        articles.push({
          url: _url.startsWith("http")
            ? _url
            : `https://finance.yahoo.com${_url}`,
          snippet: p || $(el).text(),
        });
      }
    });

    return articles || [];
  } catch (e) {
    console.error(
      `Scrape failed for ${ticker}:`,
      e instanceof Error ? e.message : e
    );
    throw e;
  }
}
