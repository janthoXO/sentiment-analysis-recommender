import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig([
  {
    input: "../contracts/openapi.yml",
    output: {
      path: "./src/generated/in", // Outputs to a dedicated schemas folder
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
