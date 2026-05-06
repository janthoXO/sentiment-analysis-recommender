import { defineConfig } from "orval"

export default defineConfig({
  // 1. Generate the API Client
  api: {
    input: {
      target: "../contracts/openapi.yml",
      filters: {
        tags: ["webclient-out"],
      },
    },
    output: {
      mode: "single",
      target: "./src/api/generated",
      schemas: "./src/api/generated/dtos",
      client: "fetch",
      fileExtension: ".gen.ts",
      clean: ["./src/api/generated"],
    },
  },
})
