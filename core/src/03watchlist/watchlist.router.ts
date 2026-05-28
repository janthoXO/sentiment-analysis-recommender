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
import { enrichStockProfile, searchTickers } from "@/stocks/stocks.api.js";
import { getUnixTime } from "date-fns";
import { env } from "@/env.js";
import { asyncHandler, HttpError } from "@/middleware/httpError.js";

export const listsRouter = Router();

listsRouter.use(authMiddleware);

listsRouter.get(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const lists = await getListsForUser(req.user!.userId);
    res.json(lists);
  })
);

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

listsRouter.post(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      throw HttpError.badRequest("MISSING_FIELD", "name required");
    }
    const list = await createList(
      req.user!.userId,
      uuidv4(),
      name.trim(),
      getUnixTime(new Date())
    );
    res.json(list);
  })
);

listsRouter.patch(
  "/:id",
  asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      throw HttpError.badRequest("MISSING_FIELD", "name required");
    }
    const updated = await renameList(
      req.user!.userId,
      req.params.id as string,
      name.trim()
    );
    if (!updated) {
      throw HttpError.notFound("LIST_NOT_FOUND", "List not found");
    }
    res.json({ id: updated.id, name: updated.name });
  })
);

listsRouter.delete(
  "/:id",
  asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
    await deleteList(req.user!.userId, req.params.id as string);
    res.json({ message: "Deleted" });
  })
);

listsRouter.post(
  "/:id/items",
  asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
    const { ticker } = req.body;
    if (!ticker || typeof ticker !== "string") {
      throw HttpError.badRequest("MISSING_FIELD", "ticker required");
    }

    const owner = await getListOwner(req.params.id as string);
    if (owner !== req.user!.userId) {
      throw HttpError.forbidden();
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
        throw HttpError.notFound("TICKER_NOT_FOUND", "Ticker not found");
      }
    }

    stock = await enrichStockProfile(stock);
    await upsertTickerStock(stock);

    await saveTracker(
      normalizedTicker,
      stock.name,
      1,
      env.WATCHLIST_SCRAPE_INTERVAL_SEC * 1000,
      null
    );
    await addListItem(req.params.id as string, normalizedTicker);
    res.json({ message: "Added" });
  })
);

listsRouter.delete(
  "/:id/items/:ticker",
  asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
    const owner = await getListOwner(req.params.id as string);
    if (owner !== req.user!.userId) {
      throw HttpError.forbidden();
    }

    await removeListItem(req.params.id as string, req.params.ticker as string);

    res.json({ message: "Removed" });
  })
);
