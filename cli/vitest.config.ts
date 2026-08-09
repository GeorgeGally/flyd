import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [ "dist/**", "node_modules/**" ],
    env: {
      FLYD_MODEL: "gpt-4o-mini",
      OPENAI_API_KEY: "test-key",
    },
  },
});
