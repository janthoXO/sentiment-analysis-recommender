import { initRouter } from "./01rest/router.js";
// always keep this import to load environment variables before anything else
import { env } from "./env.js";
import { connectMq } from "./03repo/mq.repo.js";

console.log("Environment variables loaded.", env);

connectMq()
  .then(() => {
    console.log("Connected to RabbitMQ natively");
    initRouter();
  })
  .catch((err) => {
    console.error("Failed to connect to RabbitMQ", err);
    process.exit(1);
  });
