import { defineConfig } from "orval";

export default defineConfig({
  // 1. Generate the API Client
  api: {
    input: {
      target: "../contracts/openapi.yml",
      filters: {
        tags: ["webclient"],
      },
    },
    output: {
      mode: "split",
      target: "./src/api",
      schemas: "./src/api/dtos",
      client: "fetch",
      fileExtension: ".gen.ts",
    },
  },
  // 2. Generate the Zod Schemas
  schemas: {
    input: {
      target: "../contracts/openapi.yml",
      filters: {
        tags: ["webclient"],
      },
    },
    output: {
      mode: "split",
      target: "./src/api",
      client: "zod",
      fileExtension: ".zod.gen.ts",
    },
  },
});
