import express from "express";
import morgan from "morgan";
import cors from "cors";

import searchRouter from "./search.router.js";
import { env } from "@/env.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function initRouter(): Promise<void> {
  const apiRouter = express.Router();

  apiRouter.get("/status", async (_req, res) => {
    res.status(200).json({ msg: "ok" });
  });

  apiRouter.use("/search", searchRouter);

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

  return Promise.resolve();
}
