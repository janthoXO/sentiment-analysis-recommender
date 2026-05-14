import z from "zod";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const zTracker = z.object({
  ticker: z.string(),
  name: z.string(),
  priority: z.number().min(1).max(4),
  expiresAt: z.number().nullable(),
  interval: z.number(),
  lastTriggeredAt: z.number().nullable().optional(),
});

export type Tracker = z.infer<typeof zTracker>;
