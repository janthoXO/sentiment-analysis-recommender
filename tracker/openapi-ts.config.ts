import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig([
  {
    input: "../contracts/openapi.yml",
    output: {
      path: "./src/api/generated/in",
      clean: true,
    },
    parser: {
      filters: {
        tags: {
          include: ["tracker-in"],
        },
      },
    },
    plugins: [{ name: "@hey-api/typescript" }, { name: "zod" }],
  },
]);
