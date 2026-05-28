import { Router } from "express";
import { getUnixTime } from "date-fns";
import type { TickerStockRepo } from "@/stocks/ticker-stock.repo.js";
import type { UserTickerAccessRepo } from "@/stocks/user-ticker-access.repo.js";
import {
  optionalAuthMiddleware,
  type AuthenticatedRequest,
} from "@/auth/auth.router.js";

function startNdjsonStream(res: import("express").Response) {
  res.contentType("application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
}

export function makeTrendsRouter({
  stockRepo,
  userTickerAccessRepo,
}: {
  stockRepo: TickerStockRepo;
  userTickerAccessRepo: UserTickerAccessRepo;
}) {
  const router = Router();
  router.use(optionalAuthMiddleware);

  // GET /api/tickers/trending
  router.get(
    "/trending",
    async (req: AuthenticatedRequest, res): Promise<void> => {
      startNdjsonStream(res);
      const userId = req.user?.userId;
      const nowSec = getUnixTime(new Date());
      try {
        const stocks = await stockRepo.getTrendingStocks();
        for (const stock of stocks) {
          res.write(JSON.stringify(stock) + "\n");
          if (userId) {
            userTickerAccessRepo
              .touch(userId, stock.ticker, nowSec)
              .catch(() => undefined);
          }
        }
        res.end();
      } catch (e) {
        console.error("Trending stream error:", e);
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: "Internal server error", code: "INTERNAL" });
        } else {
          res.write(
            JSON.stringify({
              error: "Internal server error",
              code: "INTERNAL",
            }) + "\n"
          );
          res.end();
        }
      }
    }
  );

  return router;
}
