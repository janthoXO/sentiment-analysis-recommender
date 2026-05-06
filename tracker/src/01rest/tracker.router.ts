import { Router } from "express";
import { zTrackRequestRoot } from "../api/generated/in/zod.gen.js";
import { createTracker } from "../02service/tracker.service.js";

const trackerRouter = Router();

trackerRouter.post("/", async (req, res) => {
  try {
    const trackRequest = zTrackRequestRoot.parse(req.body);

    const expectedCount = await createTracker(trackRequest);

    res.json({ expectedArticles: expectedCount });
  } catch {
    console.error("Track router error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default trackerRouter;
