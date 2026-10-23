import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCodingDomain } from "../coding.js";
import { FirstmateDomainTransport } from "../firstmate.js";
import { listDomainRuns } from "../store.js";

describe("coding domain guard", () => {
  let dir: string | undefined;
  const oldCommandDir = process.env.FLYD_COMMAND_DIR;
  afterEach(() => {
    if (oldCommandDir === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = oldCommandDir;
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("refuses a missing project without creating a run, or submitting", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-coding-guard-"));
    process.env.FLYD_COMMAND_DIR = dir;
    const exec = vi.fn(async () => ({ stdout: JSON.stringify({ id: "note-1", saved: true }), stderr: "" }));
    const result = await dispatchCodingDomain({
      originalMessage: "Fix it", intendedOutcome: "Fix it", doneWhen: ["it is fixed"], source: "chat",
      project: { root: join(dir, "missing") }, transport: new FirstmateDomainTransport({ exec }),
    });
    expect(result).toEqual({ status: "refused", reason: "project_not_found" });
    expect(listDomainRuns()).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, "refusals.jsonl"), "utf8")).toContain('"origin":"chat","reason":"project_not_found"');
  });

  it("creates exactly one run for an existing project", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-coding-guard-"));
    process.env.FLYD_COMMAND_DIR = join(dir, "commands");
    vi.stubEnv("VITEST", "");
    const exec = vi.fn(async (_script: string, args: string[]) => ({
      stdout: args[0] === "ready" ? JSON.stringify({ can_receive: true }) : JSON.stringify({ id: "note-1", saved: true }), stderr: "",
    }));
    const result = await dispatchCodingDomain({
      originalMessage: "Fix it", intendedOutcome: "Fix it", doneWhen: ["it is fixed"], project: { root: dir },
      transport: new FirstmateDomainTransport({ exec }),
    });
    expect(result.status).toBe("accepted");
    expect(listDomainRuns()).toHaveLength(1);
    expect(exec.mock.calls.filter(([, args]) => args[0] === "note")).toHaveLength(1);
  });

  it("refuses an existing project when invoked by a test worker", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-coding-guard-"));
    process.env.FLYD_COMMAND_DIR = join(dir, "commands");
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const result = await dispatchCodingDomain({
      originalMessage: "Fix it", intendedOutcome: "Fix it", doneWhen: ["it is fixed"], source: "system",
      project: { root: dir }, transport: new FirstmateDomainTransport({ exec }),
    });
    expect(result).toEqual({ status: "refused", reason: "test_worker" });
    expect(listDomainRuns()).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, "commands", "refusals.jsonl"), "utf8")).toContain('"origin":"system","reason":"test_worker"');
  });
});
