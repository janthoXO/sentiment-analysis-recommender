import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  type AuthenticatedRequest,
  authMiddleware,
} from "../auth/auth.router.js";
import type { WatchlistRepo } from "./watchlist.repo.js";
import type { TrackerService } from "../tracker/tracker.service.js";
import type { TickerStockRepo } from "../stocks/ticker-stock.repo.js";
import { enrichStockProfile } from "../stocks/stocks.api.js";
import { getUnixTime } from "date-fns";
import { env } from "../env.js";
import { asyncHandler, HttpError } from "../middleware/httpError.js";

export function makeWatchlistRouter({
  watchlistRepo,
  trackerService,
  tickerStockRepo,
  searchTickers,
}: {
  watchlistRepo: WatchlistRepo;
  trackerService: TrackerService;
  tickerStockRepo: TickerStockRepo;
  searchTickers: (
    query: string
  ) => Promise<import("../generated/in/index.js").StockRoot[]>;
}) {
  const listsRouter = Router();

  listsRouter.use(authMiddleware);

  listsRouter.get(
    "/",
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const lists = await watchlistRepo.getListsForUser(req.user!.userId);
      res.json(lists);
    })
  );

  listsRouter.post(
    "/",
    asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        throw HttpError.badRequest("MISSING_FIELD", "name required");
      }
      const list = await watchlistRepo.createList(
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
      const updated = await watchlistRepo.renameList(
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
      await watchlistRepo.deleteList(req.user!.userId, req.params.id as string);
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

      const owner = await watchlistRepo.getListOwner(req.params.id as string);
      if (owner !== req.user!.userId) {
        throw HttpError.forbidden();
      }

      const normalizedTicker = ticker.toUpperCase().trim();
      let stock = await tickerStockRepo.getTickerStock(normalizedTicker);
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
      await tickerStockRepo.upsertTickerStock(stock);

      await trackerService.saveTracker(
        normalizedTicker,
        1,
        env.WATCHLIST_SCRAPE_INTERVAL_SEC * 1000,
        null
      );
      await watchlistRepo.addListItem(
        req.params.id as string,
        normalizedTicker
      );
      res.json({ message: "Added" });
    })
  );

  listsRouter.delete(
    "/:id/items/:ticker",
    asyncHandler(async (req: AuthenticatedRequest, res): Promise<void> => {
      const owner = await watchlistRepo.getListOwner(req.params.id as string);
      if (owner !== req.user!.userId) {
        throw HttpError.forbidden();
      }

      await watchlistRepo.removeListItem(
        req.params.id as string,
        req.params.ticker as string
      );

      res.json({ message: "Removed" });
    })
  );

  return listsRouter;
}
