import { z } from "zod";
export default z.object({
    scanJobId: z
        .string()
        .uuid()
        .describe("The unique correlation ID for this entire aggregation job.")
        .optional(),
    stockId: z.string().describe("The ticker symbol (e.g., TSLA)."),
    interval: z
        .number()
        .int()
        .gte(1)
        .describe("The interval in seconds at which the tracker should check for new articles. For example, if set to 60, the tracker will look for new articles every minute."),
    ttl: z
        .number()
        .int()
        .gte(1)
        .describe("Time-to-live in seconds for this tracking job. After this time, the tracker should stop looking for new articles and clean up any resources."),
});
//# sourceMappingURL=TrackRequest.gen.js.map