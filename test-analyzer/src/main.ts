// always keep this import to load environment variables before anything else
import { env } from "./env.js";

console.log("Environment variables loaded.", env);
import amqplib from "amqplib";

let channel: amqplib.Channel;

export async function connectMq() {
  const conn = await amqplib.connect(env.RABBITMQ_URL);
  channel = await conn.createChannel();

  await channel.assertQueue("analyzer.tasks", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });

  await channel.assertQueue("analyzer.results", { durable: true });

  // Process up to 10 messages concurrently
  await channel.prefetch(10);

  // 1. Listen on the 'analyzer.tasks' queue
  channel.consume("analyzer.tasks", async (msg) => {
    if (!msg) return;

    console.debug("Received MQ message:", msg.content.toString());

    try {
      // take whatever arrives and parse it
      const {stock, jobId, sources}: { stock: any; jobId: string; sources: any[] } = JSON.parse(msg.content.toString());

      // Publish one result per source
      for (const source of sources) {
        channel.sendToQueue(
          "analyzer.results",
          Buffer.from(
            JSON.stringify({
              ticker: stock.ticker,
              jobId,
              source: { score: 1, ...source },
            }),
          ),
          { persistent: true }, // Ensures the message survives a RabbitMQ restart
        );
      }

      console.log(`Processed task and pushed ${sources.length} scores to analyzer.results.`);
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      // Always acknowledge the message so RabbitMQ removes it from the 'analyzer.tasks' queue
      channel.ack(msg);
    }
  });
}

connectMq().catch((err) => {
  console.error("Failed to connect to RabbitMQ", err);
  process.exit(1);
});
