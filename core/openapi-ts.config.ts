import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig([
  {
    input: "../contracts/openapi.yml",
    output: {
      path: "./src/api/generated/out",
      clean: true,
    },
    parser: {
      filters: {
        tags: {
          include: ["core-out"],
        },
      },
    },
    plugins: [
      { name: "@hey-api/client-fetch" },
      { name: "@hey-api/sdk", validator: true },
      { name: "zod" },
    ],
  },

  {
    input: "../contracts/openapi.yml",
    output: {
      path: "./src/api/generated/in", // Outputs to a dedicated schemas folder
      clean: true,
    },
    parser: {
      filters: {
        tags: {
          include: ["core-in"],
        },
      },
    },
    plugins: [{ name: "@hey-api/typescript" }, { name: "zod" }],
  },
]);
