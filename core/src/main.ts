import { initRouter } from "./router.js";
// always keep this import to load environment variables before anything else
import { env } from "./env.js";
import { connectMq } from "./mq.repo.js";
import {
  initPersistedTrackers,
  initTopTrackers,
} from "./01tracker/tracker.service.js";
import { runMigrations } from "./postgres.repo.js";
import { initTrendingTickers } from "./01tracker/tracker.service.js";

console.log("Environment variables loaded.", env);

async function bootstrap() {
  await Promise.all([
    connectMq()
      .then(() => {
        console.log("Connected to RabbitMQ natively");
      })
      .catch((err) => {
        console.error("Failed to connect to RabbitMQ", err);
        throw err;
      }),
    runMigrations()
      .then(() => {
        console.log("Database migrations completed");
      })
      .catch((err) => {
        console.log("Database migrations failed", err);
        throw err;
      }),
  ]);

  initRouter();
  initPersistedTrackers().catch((err) =>
    console.error("Failed to init persisted trackers", err)
  );
  // initTopTrackers().catch((err) => {
  //   console.error("Failed to init top trackers", err);
  //   throw err;
  // });
  initTrendingTickers().catch((err) =>
    console.error("Failed to init trending tickers", err)
  );
}

bootstrap().catch(() => {
  console.error("Failed to bootstrap application");
  process.exit(1);
});
