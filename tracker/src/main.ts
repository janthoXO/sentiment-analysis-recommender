import { initRouter } from "./01rest/router.js";
// always keep this import to load environment variables before anything else
import { env } from "./env.js";
import { connectMq } from "./03repo/mq.repo.js";
import { connectRedis } from "./03repo/redis.repo.js";
import { hydrateJobsOnStartup } from "./02service/tracker.service.js";

console.log("Environment variables loaded.", env);

const bootstrap = async () => {
  try {
    await connectMq();
    console.log("Connected to RabbitMQ in Tracker");

    await connectRedis();
    console.log("Connected to Tracker Redis");

    await hydrateJobsOnStartup();

    initRouter();
  } catch (err) {
    console.error("Bootstrap failed", err);
    process.exit(1);
  }
};

bootstrap();
