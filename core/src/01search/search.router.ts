import { Router } from "express";
import type { Request, Response } from "express";
import { processTickers } from "./search.service.js";
import { zGetApiSearchQuery } from "@/generated/in/zod.gen.js";

const searchRouter = Router();

async function handleSearch(req: Request, res: Response): Promise<void> {
  try {
    console.log("Received search request with query:", req.query);
    const { topic, tickers: tickerQuery } = zGetApiSearchQuery.parse(req.query);
    const tickers = tickerQuery
      ? tickerQuery.split(",").map((t) => t.trim())
      : null;

    if (!topic && !tickers) {
      res.status(400).json({ error: "Topic or tickers are required" });
      return;
    }

    res.contentType("application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    if (topic) {
      res.write(
        JSON.stringify({ error: "topic search not yet supported" }) + "\n"
      );
      res.end();
      return;
    }

    if (tickers) {
      for await (const result of processTickers(tickers)) {
        res.write(JSON.stringify(result) + "\n");
      }
    }

    res.end();
  } catch (e) {
    console.error("Search router error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal error" });
    } else {
      res.write(JSON.stringify({ error: "Internal error" }) + "\n");
      res.end();
    }
  }
}

searchRouter.get("/", handleSearch);

export default searchRouter;
