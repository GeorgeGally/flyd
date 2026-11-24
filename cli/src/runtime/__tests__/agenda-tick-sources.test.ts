import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Every model call a tick job makes is recorded under that job's own source.
const sources = vi.hoisted(() => [] as string[]);
vi.mock("../../lib/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm.js")>()),
  query: vi.fn(async (_prompt: string, _model?: string, _system?: string, _a?: unknown, _b?: unknown, options?: { source?: string }) => {
    sources.push(options?.source ?? "");
    return "{}";
  }),
}));
const ask = (complete: (prompt: string) => Promise<string>) => complete("prompt");
vi.mock("../../council/council.js", () => ({ runCouncilPass: vi.fn(async ({ complete }) => { await ask(complete); return { skipped: true, advisories: [] }; }) }));
vi.mock("../../council/taste.js", () => ({ learnTaste: vi.fn(async ({ complete }) => { await ask(complete); }) }));
vi.mock("../../council/scout.js", () => ({ scoutTick: vi.fn(async ({ complete }) => { await ask(complete); return []; }), editionActivityRecord: () => ({}) }));

const { agendaTickSource, defaultTickJobs } = await import("../agenda-tick.js");

describe("agenda tick sources", () => {
  it("gives each model job its own source tag", async () => {
    const backoffPath = join(mkdtempSync(join(tmpdir(), "flyd-tick-src-")), "backoff.json");
    const jobs = await defaultTickJobs({ backoffPath });
    for (const name of ["council", "taste", "scout"]) await jobs.find((job) => job.name === name)!.run();
    expect(sources).toEqual(["runtime/agenda-tick:council", "runtime/agenda-tick:taste", "runtime/agenda-tick:scout"]);
    expect(agendaTickSource("self-improve")).toBe("runtime/agenda-tick:self-improve");
  });
});
