import { Router } from "express";
import { processSearch } from "../02service/search.service.js";
import { zGetApiSearchQuery } from "../api/generated/zod.gen.js";
const searchRouter = Router();
async function handleSearch(req, res) {
    try {
        const { query } = zGetApiSearchQuery.parse(req.query);
        const ticker = query.toUpperCase();
        res.contentType("application/x-ndjson");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("Cache-Control", "no-cache");
        const result = await processSearch(ticker);
        res.write(JSON.stringify(result) + "\\n");
        res.end();
    }
    catch (e) {
        console.error("Search router error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal error" });
        }
        else {
            res.write(JSON.stringify({ error: "Internal error" }) + "\\n");
            res.end();
        }
    }
}
searchRouter.get("/", handleSearch);
export default searchRouter;
//# sourceMappingURL=search.router.js.map