import { defineConfig } from "orval";

export default defineConfig({
  // 1. Generate the API Client
  api: {
    input: {
      target: "../contracts/openapi.yml",
      filters: {
        tags: ["core"],
      },
    },
    output: {
      mode: "split",
      target: "./src/api",
      schemas: "./src/dtos",
      client: "fetch",
    },
  },
  // 2. Generate the Zod Schemas
  schemas: {
    input: {
      target: "../contracts/openapi.yml",
      filters: {
        tags: ["core"],
      },
    },
    output: {
      mode: "split",
      target: "./src/dtos",
      client: "zod",
    },
  },
});
