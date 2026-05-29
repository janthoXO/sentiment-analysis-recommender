// always keep this import to load environment variables before anything else
import { env } from "./env.js";

console.log("Environment variables loaded.", env);
import amqplib from "amqplib";

let channel: amqplib.Channel;

export async function connectMq() {
  const conn = await amqplib.connect(env.RABBITMQ_URL);
  channel = await conn.createChannel();

  await channel.assertExchange(env.MQ_EXCHANGE, "direct", { durable: true });

  await channel.assertQueue("analyzer.tasks", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });
  await channel.bindQueue("analyzer.tasks", env.MQ_EXCHANGE, "analyzer.tasks");

  await channel.assertQueue("analyzer.results", { durable: true });
  await channel.bindQueue("analyzer.results", env.MQ_EXCHANGE, "analyzer.results");

  await channel.prefetch(10);

  channel.consume("analyzer.tasks", async (msg) => {
    if (!msg) return;

    console.debug("Received MQ message:", msg.content.toString());

    try {
      const { stock, jobId, sources }: { stock: any; jobId: string; sources: any[] } = JSON.parse(msg.content.toString());

      for (const source of sources) {
        channel.publish(
          env.MQ_EXCHANGE,
          "analyzer.results",
          Buffer.from(
            JSON.stringify({
              ticker: stock.ticker,
              jobId,
              source: { score: 1, ...source },
            }),
          ),
          { persistent: true },
        );
      }

      console.log(`Processed task and pushed ${sources.length} scores to analyzer.results.`);
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      channel.ack(msg);
    }
  });
}

connectMq().catch((err) => {
  console.error("Failed to connect to RabbitMQ", err);
  process.exit(1);
});
