import { defineConfig } from "vitest/config";

// Behavioral evals — product-contract scenarios, separate from unit tests.
// Run with `npm run evals`. Gates: a failed assertion exits non-zero.
export default defineConfig({
  test: {
    include: ["src/evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
