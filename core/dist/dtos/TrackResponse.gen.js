import { z } from "zod";
export default z.object({
    scanJobId: z.string().uuid(),
    expectedArticles: z
        .number()
        .int()
        .gte(0)
        .describe("The number of articles the tracker found and pushed to RabbitMQ. Is only filled if the ttl if set to 0, indicating that it is a one-time scrape command."),
});
//# sourceMappingURL=TrackResponse.gen.js.map