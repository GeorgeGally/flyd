import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Runtime integration files share one Postgres fixture; one temporarily
    // changes its schema to characterize orphaned events, so parallel files
    // can deadlock an unrelated transaction.
    fileParallelism: false,
    exclude: [ "dist/**", "node_modules/**" ],
    env: {
      FLYD_MODEL: "gpt-4o-mini",
      OPENAI_API_KEY: "test-key",
    },
  },
});
