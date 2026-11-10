import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { commitDomainRun, createDomainRun, readDomainRun, saveDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const run = (id = "domain-store-1"): DomainRun => ({
  id,
  request: { id, domain: "coding", originalMessage: "Fix the island", intendedOutcome: "Fix the island", doneWhen: [], createdAt: "2026-11-11T00:00:00.000Z" },
  owner: "FirstMate", status: "working", createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z",
  transport: { kind: "firstmate", requestId: id },
});

const message = (id: string) => ({ id, kind: "question" as const, body: id, at: "2026-11-11T00:00:00.000Z" });

describe("command store", () => {
  it("applies a change made from an earlier read onto the run as it is now", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-store-"));
    saveDomainRun(run(), dir);
    const before = readDomainRun("domain-store-1", dir)!;
    // Another process sends him a message and marks the run told meanwhile.
    commitDomainRun(before, { ...before, messages: [message("from-view")], notified: true }, dir);
    // The sync, still holding its earlier read, records the reply it read.
    const saved = commitDomainRun(before, { ...before, status: "completed", messages: [message("check-in")] }, dir);
    expect([saved.status, saved.notified, saved.messages?.map((item) => item.id), saved.revision]).toEqual(["completed", true, ["check-in", "from-view"], 3]);
    expect(createDomainRun({ ...run(), status: "queued" }, dir)).toEqual({ run: saved, created: false });
  });

  it("loses no update when two processes write the same run at once", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-store-"));
    saveDomainRun(run(), dir);
    const store = pathToFileURL(resolve(import.meta.dirname, "../store.ts")).href;
    const writer = join(dir, "writer.mts");
    writeFileSync(writer, [
      `const { updateDomainRun } = await import(${JSON.stringify(store)});`,
      "const [dir, who] = process.argv.slice(2);",
      "for (let n = 0; n < 200; n += 1) updateDomainRun('domain-store-1', (current) => ({ ...current, messages: [...(current.messages ?? []), { id: `${who}-${n}`, kind: 'question', body: who, at: new Date().toISOString() }] }), dir);",
    ].join("\n"));
    // As Core's scheduler and `flyd view` do: two processes, each writing the run 200 times.
    const write = (who: string) => new Promise<number | null>((done) => {
      spawn(process.execPath, ["--import", "tsx", writer, dir!, who], { cwd: resolve(import.meta.dirname, "../../.."), stdio: "ignore" }).on("exit", done);
    });
    expect(await Promise.all([write("core"), write("view")])).toEqual([0, 0]);
    const saved = readDomainRun("domain-store-1", dir)!;
    expect([saved.messages?.length, saved.revision]).toEqual([400, 401]);
  }, 30_000);
});
