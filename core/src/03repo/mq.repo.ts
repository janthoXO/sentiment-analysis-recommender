import amqplib from "amqplib";
import { env } from "../env.js";
import * as inFlight from "../02service/inFlight.service.js";

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

  await channel.prefetch(10);

  channel.consume("results", async (msg) => {
    if (!msg) return;

    console.debug("Received MQ message:", msg.content.toString());

    try {
      const { scanJobId, score, snippet, url } = JSON.parse(
        msg.content.toString()
      );

      await inFlight.receive(scanJobId, { score, snippet, url });
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      channel.ack(msg);
    }
  });
}
