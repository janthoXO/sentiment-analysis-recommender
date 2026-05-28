import amqplib from "amqplib";
import { zSourceResultRoot } from "../generated/in/zod.gen.js";
import z from "zod";
import type { SourceRoot, StockRoot } from "../generated/in/index.js";

const zAnalyzerResult = z.object({
  ticker: z.string(),
  jobId: z.string(),
  source: zSourceResultRoot,
});

export interface MqHandlers {
  onAnalyzerResult: (result: z.infer<typeof zAnalyzerResult>) => Promise<void>;
}

export interface MqClient {
  publishAnalysisTask(
    stock: StockRoot,
    jobId: string,
    sources: SourceRoot[],
    priority: number
  ): void;
}

export async function connectMq(
  url: string,
  handlers: MqHandlers
): Promise<MqClient> {
  const conn = await amqplib.connect(url);
  const channel = await conn.createChannel();

  await channel.assertQueue("analyzer.tasks", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });

  await channel.assertQueue("analyzer.results", { durable: true });

  await channel.prefetch(10);

  channel.consume("analyzer.results", async (msg) => {
    if (!msg) return;
    try {
      const result = zAnalyzerResult.parse(JSON.parse(msg.content.toString()));
      await handlers.onAnalyzerResult(result);
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      channel.ack(msg);
    }
  });

  return {
    publishAnalysisTask(stock, jobId, sources, priority) {
      channel.sendToQueue(
        "analyzer.tasks",
        Buffer.from(JSON.stringify({ stock, jobId, sources })),
        { priority }
      );
    },
  };
}
