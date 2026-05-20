// always keep this import to load environment variables before anything else
import { env } from "./env.js";

console.log("Environment variables loaded.", env);
import amqplib from "amqplib";

let channel: amqplib.Channel;

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

  // Process up to 10 messages concurrently
  await channel.prefetch(10);

  // 1. Listen on the 'tasks' queue
  channel.consume("tasks", async (msg) => {
    if (!msg) return;

    console.debug("Received MQ message:", msg.content.toString());

    try {
      // take whatever arrives and parse it
      const {ticker, jobId, sources}: { ticker: string; jobId: string; sources: any[] } = JSON.parse(msg.content.toString());

      // We publish it to the exchange with the routing key "result"
      channel.publish(
        "sentinel.analyze",
        "result",
        Buffer.from(
          JSON.stringify({
            ticker,
            jobId,
            sources: sources.map((s) => ({score: 1, ...s})),
          }),
        ),
        { persistent: true }, // Ensures the message survives a RabbitMQ restart
      );

      console.log("Processed task, appended score, and routed to results.");
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      // Always acknowledge the message so RabbitMQ removes it from the 'tasks' queue
      channel.ack(msg);
    }
  });
}

connectMq().catch((err) => {
  console.error("Failed to connect to RabbitMQ", err);
  process.exit(1);
});
