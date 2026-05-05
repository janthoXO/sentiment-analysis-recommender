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
      mode: "single",
      target: "./src/api",
      client: "fetch",
      fileExtension: ".gen.ts",
      clean: ["./src/api/**/*.gen.ts"],
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
      mode: "single",
      target: "./src/dtos",
      client: "zod",
      fileExtension: ".gen.ts",
      clean: ["./src/dtos/**/*.gen.ts"],
    },
  },
});
