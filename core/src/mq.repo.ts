import amqplib from "amqplib";
import { env } from "./env.js";
import * as inFlight from "@/02analyzer/analyzer.service.js";
import { zSourceResultRoot } from "./generated/in/zod.gen.js";
import z from "zod";
import type { Root } from "./generated/in/index.js";

let channel: amqplib.Channel;

const zAnalyzerResult = z.object({
  ticker: z.string(),
  jobId: z.string(),
  sources: z.array(zSourceResultRoot),
});

export async function connectMq() {
  const conn = await amqplib.connect(env.RABBITMQ_URL);
  channel = await conn.createChannel();

  await channel.assertExchange("sentinel.analyze", "direct", { durable: true });

  await channel.assertQueue("tasks", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });
  await channel.bindQueue("tasks", "sentinel.analyze", "tasks");

  await channel.assertQueue("results", { durable: true });
  await channel.bindQueue("results", "sentinel.analyze", "result");

  await channel.prefetch(10);

  channel.consume("results", async (msg) => {
    if (!msg) return;

    console.debug("Received MQ message:", msg.content.toString());

    try {
      const { jobId, sources } = zAnalyzerResult.parse(
        JSON.parse(msg.content.toString())
      );

      await inFlight.receiveResult(jobId, sources);
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      channel.ack(msg);
    }
  });
}

export const publishAnalysisTask = (
  ticker: string,
  jobId: string,
  sources: Root[],
  priority: number
) => {
  if (!channel) throw new Error("MQ channel not initialized");
  channel.publish(
    "sentinel.analyze",
    "tasks",
    Buffer.from(JSON.stringify({ ticker, jobId, sources })),
    { priority }
  );
};
