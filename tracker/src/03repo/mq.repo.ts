import amqplib from "amqplib";
import { env } from "../env.js";

let channel: amqplib.Channel;

export const connectMq = async () => {
  const conn = await amqplib.connect(
    env.RABBITMQ_URL || "amqp://sentinel:sentinel@localhost:5672"
  );
  channel = await conn.createChannel();

  await channel.assertExchange("sentinel.analyze", "direct", { durable: true });

  await channel.assertQueue("tasks", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });
  await channel.bindQueue("tasks", "sentinel.analyze", "tasks");

  await channel.assertQueue("results", { durable: true });
  await channel.bindQueue("results", "sentinel.analyze", "result");
};

export const publishTask = (
  ticker: string,
  priority: number,
  snippet: string,
  url: string,
  scanJobId?: string
) => {
  if (!channel) throw new Error("MQ channel not initialized");
  channel.publish(
    "sentinel.analyze",
    "tasks",
    Buffer.from(JSON.stringify({ ticker, snippet, url, scanJobId })),
    { priority }
  );
};
