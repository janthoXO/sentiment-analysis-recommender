import { z } from "zod";
export default z.object({
    scanJobId: z.string().uuid().optional(),
    stockId: z.string(),
    url: z.string().url(),
    snippet: z.string().describe("The raw text scraped from the article."),
    priority: z
        .number()
        .int()
        .describe("The priority of the task, where a lower number indicates higher priority.")
        .optional(),
});
//# sourceMappingURL=AnalyzerTask.gen.js.map