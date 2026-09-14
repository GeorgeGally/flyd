import { describe, expect, it } from "vitest";
import pg from "pg";
import { ensureRuntimeSchema } from "../runtime-schema.js";

describe("ensureRuntimeSchema", () => {
  it("retries bootstrap after a transient failure instead of caching the rejection", async () => {
    const pool = {} as pg.Pool;
    let attempts = 0;
    const rawQuery = async (): Promise<void> => {
      attempts += 1;
      if (attempts === 1) throw new Error("database is starting up");
    };

    await expect(ensureRuntimeSchema(pool, rawQuery)).rejects.toThrow("database is starting up");
    await expect(ensureRuntimeSchema(pool, rawQuery)).resolves.toBeUndefined();
  });

  it("bootstraps once and reuses the resolved result for later calls", async () => {
    const pool = {} as pg.Pool;
    let calls = 0;
    const rawQuery = async (): Promise<void> => {
      calls += 1;
    };

    await ensureRuntimeSchema(pool, rawQuery);
    const afterFirst = calls;
    await ensureRuntimeSchema(pool, rawQuery);

    expect(afterFirst).toBeGreaterThan(0);
    expect(calls).toBe(afterFirst);
  });
});
