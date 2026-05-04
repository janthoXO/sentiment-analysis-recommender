import express from "express";
const router = express.Router();
router.get("/", async (_, res) => {
    res.status(200).json({ msg: "This is an example endpoint" });
});
export default router;
//# sourceMappingURL=example.router.js.map