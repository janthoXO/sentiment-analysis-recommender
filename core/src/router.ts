import express from "express";
import morgan from "morgan";
import cors from "cors";
import type { Router } from "express";
import { env } from "./env.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function initApp({
  stocksRouter,
  candlesRouter,
  articlesRouter,
  sentimentRouter,
  trendsRouter,
  watchlistRouter,
  authRouter,
}: {
  stocksRouter: Router;
  candlesRouter: Router;
  articlesRouter: Router;
  sentimentRouter: Router;
  trendsRouter: Router;
  watchlistRouter: Router;
  authRouter: Router;
}): void {
  const apiRouter = express.Router();

  apiRouter.get("/status", (_req, res) => {
    res.status(200).json({ msg: "ok" });
  });

  // Mount under /tickers — order matters: literal paths before /:tickerId/*
  apiRouter.use("/tickers", trendsRouter); // /trending
  apiRouter.use("/tickers", articlesRouter); // /articles and /:id/articles
  apiRouter.use("/tickers", sentimentRouter); // /:id/articles/sentiment
  apiRouter.use("/tickers", candlesRouter); // /:id/candles
  apiRouter.use("/tickers", stocksRouter); // / and /:id/peers

  apiRouter.use("/auth", authRouter);
  apiRouter.use("/lists", watchlistRouter);

  const app = express();
  app.use(express.json());
  app.use(cors());
  if (env.DEBUG === true) {
    app.use(morgan("dev"));
  }
  app.use("/api", apiRouter);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`[REST] Server is running on port ${env.PORT}`);
  });
}
