import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  type AuthenticatedRequest,
  authMiddleware,
} from "../auth/auth.router.js";
import {
  getListsForUser,
  getAllTickersForUser,
  createList,
  renameList,
  deleteList,
  addListItem,
  removeListItem,
  getListOwner,
} from "./watchlist.repo.js";
import { saveTracker } from "../01tracker/tracker.service.js";
import {
  getTickerStock,
  upsertTickerStock,
} from "../01search/ticker-stock.repo.js";
import { sentimentEmitter, type SentimentChangeEvent } from "../events.js";
import { searchTickers } from "@/stocks/stocks.api.js";
import { getUnixTime } from "date-fns";
import { env } from "@/env.js";

export const listsRouter = Router();

listsRouter.use(authMiddleware);

// GET /api/lists — return all lists with their items
listsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const lists = await getListsForUser(req.user!.userId);
    res.json(lists);
  } catch (err) {
    console.error("Get lists error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/lists/stream — SSE (must be before /:id to avoid param shadowing)
listsRouter.get("/stream", (req: AuthenticatedRequest, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const userId = req.user!.userId;

  const handleSentimentChange = async (event: SentimentChangeEvent) => {
    const tickers = await getAllTickersForUser(userId);
    if (tickers.includes(event.ticker)) {
      res.write(
        `data: ${JSON.stringify({ type: "TICKER_UPDATE", payload: event.result })}\n\n`
      );
    }
  };

  sentimentEmitter.on("sentiment-update", handleSentimentChange);

  req.on("close", () => {
    sentimentEmitter.off("sentiment-update", handleSentimentChange);
    res.end();
  });
});

// POST /api/lists — create a new list
listsRouter.post("/", async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name required" });
      return;
    }
    const list = await createList(
      req.user!.userId,
      uuidv4(),
      name.trim(),
      getUnixTime(new Date())
    );
    res.json(list);
  } catch (err) {
    console.error("Create list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/lists/:id — rename a list
listsRouter.patch(
  "/:id",
  async (req: AuthenticatedRequest, res): Promise<void> => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name required" });
        return;
      }
      const updated = await renameList(
        req.user!.userId,
        req.params.id as string,
        name.trim()
      );
      if (!updated) {
        res.status(404).json({ error: "List not found" });
        return;
      }
      res.json({ id: updated.id, name: updated.name });
    } catch (err) {
      console.error("Rename list error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/lists/:id — delete a list (cascades to items)
listsRouter.delete(
  "/:id",
  async (req: AuthenticatedRequest, res): Promise<void> => {
    try {
      await deleteList(req.user!.userId, req.params.id as string);
      res.json({ message: "Deleted" });
    } catch (err) {
      console.error("Delete list error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /api/lists/:id/items — add a ticker to a list
listsRouter.post(
  "/:id/items",
  async (req: AuthenticatedRequest, res): Promise<void> => {
    try {
      const { ticker } = req.body;
      if (!ticker || typeof ticker !== "string") {
        res.status(400).json({ error: "ticker required" });
        return;
      }

      const owner = await getListOwner(req.params.id as string);
      if (owner !== req.user!.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const normalizedTicker = ticker.toUpperCase().trim();
      let stock = await getTickerStock(normalizedTicker);
      if (!stock) {
        stock = await searchTickers(normalizedTicker).then(
          (results) =>
            results.find((s) => s.ticker.toUpperCase() === normalizedTicker) ??
            null
        );

        if (!stock) {
          res.status(400).json({ error: "Ticker not found" });
          return;
        }

        await upsertTickerStock(stock);
      }

      await saveTracker(normalizedTicker, normalizedTicker, 1, env.WATCHLIST_SCRAPE_INTERVAL_SEC * 1000, null);
      await addListItem(req.params.id as string, normalizedTicker);
      res.json({ message: "Added" });
    } catch (err) {
      console.error("Add list item error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/lists/:id/items/:ticker — remove a ticker from a list
listsRouter.delete(
  "/:id/items/:ticker",
  async (req: AuthenticatedRequest, res): Promise<void> => {
    try {
      const owner = await getListOwner(req.params.id as string);
      if (owner !== req.user!.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      await removeListItem(
        req.params.id as string,
        req.params.ticker as string
      );

      res.json({ message: "Removed" });
    } catch (err) {
      console.error("Remove list item error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
