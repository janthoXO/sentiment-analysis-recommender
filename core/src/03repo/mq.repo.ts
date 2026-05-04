import amqplib from "amqplib";
import { env } from "../env.js";
import * as db from "./postgres.repo.js";
import * as cache from "./cache.repo.js";
import * as inFlight from "../02service/inFlight.service.js";
import type { Root } from "@/api/generated/types.gen.js";

let channel: amqplib.Channel;

export async function finalizeJob(scanJobId: string) {
  const entry = inFlight.finalize(scanJobId);
  if (!entry) return;

  const validScores = entry.buffer
    .map((b) => b.score)
    .filter((s) => s !== null) as number[];
  let avgScore: number | null = null;
  if (validScores.length > 0) {
    avgScore = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  }

  const articleCount = entry.buffer.length;

  await db.upsertScore({ ticker: entry.ticker, avgScore, articleCount });

  const queryResult: Root = {
    stock: {
      id: entry.figi,
      ticker: entry.ticker,
      name: entry.name,
    },
    score: avgScore || 0,
    sources: entry.buffer.map((b) => ({
      url: b.url,
      snippet: b.snippet,
      score: b.score || 0,
    })),
  };

  await cache.set(entry.ticker, queryResult);

  for (const resolve of entry.subscribers) {
    resolve(queryResult);
  }
}

export async function connectMq() {
  const conn = await amqplib.connect(env.RABBITMQ_URL);
  channel = await conn.createChannel();

  await channel.assertExchange("sentinel.tasks", "direct", { durable: true });

  await channel.assertQueue("tasks.high", {
    durable: true,
    arguments: { "x-max-priority": 10 },
  });
  await channel.bindQueue("tasks.high", "sentinel.tasks", "task.high");

  await channel.assertQueue("results", { durable: true });
  await channel.bindQueue("results", "sentinel.tasks", "result");

  await channel.prefetch(10);

  channel.consume("results", async (msg) => {
    if (!msg) return;
    try {
      const parsed = JSON.parse(msg.content.toString());
      const { scanJobId, ticker, score, snippet, url } = parsed;

      await db.saveArticle({ scanJobId, ticker, snippet, url, score });

      const isComplete = inFlight.receive(scanJobId, { score, snippet, url });
      if (isComplete) {
        await finalizeJob(scanJobId);
      }
    } catch (e) {
      console.error("Error processing MQ message", e);
    } finally {
      channel.ack(msg);
    }
  });
}
