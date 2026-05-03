import { initRouter } from "./01rest/router.js";
// always keep this import to load environment variables before anything else
import { env } from "./env.js";

console.log("Environment variables loaded.", env);

initRouter();
