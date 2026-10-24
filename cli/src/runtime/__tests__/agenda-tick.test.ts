import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTickJobs, type TickJob } from "../agenda-tick.js";
import { backoffUntil, guardModelCall, isUsageLimitError, readModelBackoff, recordModelBackoff } from "../model-backoff.js";

describe("agenda tick", () => {
  let dir: string;
  let backoffPath: string;
  const now = new Date("2026-10-24T10:00:00Z");
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-tick-"));
    backoffPath = join(dir, "model-backoff.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const job = (name: string, usesModel: boolean, ran: string[], fail?: Error): TickJob => ({
    name, usesModel,
    run: async () => { ran.push(name); if (fail) throw fail; return undefined; },
  });

  it("keeps running later jobs when one throws", async () => {
    const ran: string[] = [];
    const lines: string[] = [];
    const results = await runTickJobs([
      job("council", true, ran, new Error("disk full")),
      job("crew", false, ran),
      job("scout", true, ran),
    ], { log: (line) => lines.push(line), now: () => now, backoffPath });
    expect(ran).toEqual(["council", "crew", "scout"]);
    expect(results.map((result) => result.status)).toEqual(["failed", "ok", "ok"]);
    expect(lines.some((line) => line.includes("council failed: disk full"))).toBe(true);
    expect(readModelBackoff(now, backoffPath)).toBeNull();
  });

  it("backs off model jobs after a usage limit, but not the others", async () => {
    const ran: string[] = [];
    const limit = Object.assign(new Error("429 You've hit your weekly usage limit"), { status: 429 });
    const results = await runTickJobs([
      job("council", true, ran, limit),
      job("crew", false, ran),
      job("taste", true, ran),
    ], { now: () => now, backoffPath });
    expect(ran).toEqual(["council", "crew"]);
    expect(results.map((result) => result.status)).toEqual(["failed", "ok", "skipped"]);
    const backoff = readModelBackoff(now, backoffPath);
    expect(backoff && Date.parse(backoff.until) - now.getTime()).toBe(60 * 60 * 1000);

    // The next tick, still inside the backoff, skips every model job.
    const later: string[] = [];
    await runTickJobs([job("council", true, later), job("crew", false, later)], { now: () => new Date(now.getTime() + 10 * 60_000), backoffPath });
    expect(later).toEqual(["crew"]);

    // Once it expires, model jobs run again.
    const after: string[] = [];
    await runTickJobs([job("council", true, after)], { now: () => new Date(now.getTime() + 2 * 60 * 60_000), backoffPath });
    expect(after).toEqual(["council"]);
  });

  it("records a usage limit even when the job swallows the model error", async () => {
    const complete = guardModelCall(async () => { throw Object.assign(new Error("rate limited"), { status: 429 }); }, { now: () => now, path: backoffPath });
    const ran: string[] = [];
    await runTickJobs([
      { name: "investigator", usesModel: true, run: async () => { await complete("x").catch(() => undefined); } },
      job("scout", true, ran),
    ], { now: () => now, backoffPath });
    expect(ran).toEqual([]);
    await expect(complete("again")).rejects.toThrow(/backed off/);
  });

  it("uses the provider's reset time when the error carries one", () => {
    const reset = new Date(now.getTime() + 3 * 60 * 60_000);
    expect(backoffUntil({ status: 429, headers: { "retry-after": "7200" } }, now).getTime()).toBe(now.getTime() + 7200_000);
    expect(backoffUntil({ status: 429, headers: { "anthropic-ratelimit-unified-reset": String(reset.getTime() / 1000) } }, now).getTime()).toBe(reset.getTime());
    expect(backoffUntil(new Error(`usage limit reached, resets at ${reset.toISOString()}`), now).getTime()).toBe(reset.getTime());
    expect(isUsageLimitError(new Error("ECONNREFUSED"))).toBe(false);
    recordModelBackoff(new Error("429"), now, backoffPath);
    expect(readModelBackoff(now, backoffPath)).not.toBeNull();
  });
});
