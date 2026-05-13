import { Router } from "express";
import type { Request, Response } from "express";
import { processQuery } from "./search.service.js";
import { zGetApiSearchQuery } from "@/generated/in/zod.gen.js";

const searchRouter = Router();

async function handleSearch(req: Request, res: Response): Promise<void> {
  try {
    console.log("Received search request with query:", req.query);
    const { q } = zGetApiSearchQuery.parse(req.query);

    if (!q) {
      res.status(400).json({ error: "q parameter is required" });
      return;
    }

    res.contentType("application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    for await (const result of processQuery(q)) {
      res.write(JSON.stringify(result) + "\n");
    }

    res.end();
  } catch (e) {
    console.error("Search router error:", e);
    res.write(JSON.stringify({ error: "Internal error" }) + "\n");
    res.end();
  }
}

searchRouter.get("/", handleSearch);

export default searchRouter;
