import amqplib from "amqplib";
import { env } from "../env.js";

let channel: amqplib.Channel;

export const connectMq = async () => {
  const conn = await amqplib.connect(
    env.RABBITMQ_URL || "amqp://sentinel:sentinel@localhost:5672"
  );
  channel = await conn.createChannel();

  await channel.assertExchange("sentinel.tasks", "direct", { durable: true });

  await channel.assertQueue("tasks.high", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });
  await channel.bindQueue("tasks.high", "sentinel.tasks", "task.high");

  await channel.assertQueue("results", { durable: true });
  await channel.bindQueue("results", "sentinel.tasks", "result");
};

export const publishTask = (
  stockId: string,
  ticker: string,
  priority: number,
  snippet: string,
  url: string,
  scanJobId?: string
) => {
  if (!channel) throw new Error("MQ channel not initialized");
  channel.publish(
    "sentinel.tasks",
    "task.high",
    Buffer.from(JSON.stringify({ stockId, ticker, snippet, url, scanJobId })),
    { priority }
  );
};
