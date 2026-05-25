import { Router } from "express";
import type { Request, Response } from "express";
import { processStock } from "./search.service.js";
import { getTickerStock } from "./ticker-stock.repo.js";

const tickersRouter = Router();

const MAX_TICKERS = 50;

tickersRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.query.tickers;
    if (!raw || typeof raw !== "string") {
      res.status(400).json({ error: "tickers query parameter required" });
      return;
    }

    const tickers = raw
      .split(",")
      .map((t) => t.toUpperCase().trim())
      .filter(Boolean)
      .slice(0, MAX_TICKERS);

    if (tickers.length === 0) {
      res.status(400).json({ error: "no valid tickers provided" });
      return;
    }

    const results = await Promise.allSettled(
      tickers.map(async (ticker) => {
        const stock = (await getTickerStock(ticker)) ?? { ticker, name: ticker };
        return processStock(stock);
      })
    );

    const tickerResults = results
      .filter(
        (r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof processStock>>>> =>
          r.status === "fulfilled" && r.value !== null
      )
      .map((r) => r.value);

    res.json(tickerResults);
  } catch (e) {
    console.error("Tickers router error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

export default tickersRouter;
