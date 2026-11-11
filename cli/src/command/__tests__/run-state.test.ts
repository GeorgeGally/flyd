import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CREATED_AS, DOMAIN_RUN_STATUSES, canMove, cameBack, isAtWork, isFinal, isOpen, isSettled } from "../run-state.js";
import { createDomainRun, readDomainRun, updateDomainRun } from "../store.js";
import type { DomainRun, DomainRunStatus } from "../types.js";

// Every (from, to) pair, written out: a change to a run's life shows up here as a changed row.
const ALLOWED: Record<DomainRunStatus | "none", DomainRunStatus[]> = {
  none: ["queued", "accepted", "working"],
  queued: ["queued", "accepted", "working", "needs_decision", "completed", "failed", "cancelled"],
  accepted: ["queued", "accepted", "working", "needs_decision", "completed", "failed", "cancelled"],
  working: ["working", "needs_decision", "completed", "failed", "cancelled"],
  needs_decision: ["working", "needs_decision", "completed", "failed", "cancelled"],
  incomplete: ["working", "needs_decision", "completed", "incomplete", "failed", "cancelled"],
  failed: ["working", "failed", "cancelled"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

const MEANING: Record<DomainRunStatus, { atWork: boolean; cameBack: boolean; settled: boolean; final: boolean; open: boolean }> = {
  queued: { atWork: true, cameBack: false, settled: false, final: false, open: true },
  accepted: { atWork: true, cameBack: false, settled: false, final: false, open: true },
  working: { atWork: true, cameBack: false, settled: false, final: false, open: true },
  needs_decision: { atWork: false, cameBack: true, settled: false, final: false, open: true },
  incomplete: { atWork: false, cameBack: false, settled: false, final: false, open: true },
  failed: { atWork: false, cameBack: true, settled: true, final: false, open: true },
  completed: { atWork: false, cameBack: true, settled: true, final: true, open: false },
  cancelled: { atWork: false, cameBack: false, settled: true, final: true, open: false },
};

const run = (status: DomainRunStatus, id = "run-state-1"): DomainRun => ({
  id,
  request: { id, domain: "coding", originalMessage: "Fix the island", intendedOutcome: "Fix the island", doneWhen: [], createdAt: "2026-11-11T00:00:00.000Z" },
  owner: "FirstMate", status, createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z",
  transport: { kind: "firstmate", requestId: id },
});

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("run state table", () => {
  const froms = ["none", ...DOMAIN_RUN_STATUSES] as const;
  const pairs = froms.flatMap((from) => DOMAIN_RUN_STATUSES.map((to) => [from, to] as const));

  it.each(pairs)("%s → %s", (from, to) => {
    expect(canMove(from === "none" ? null : from, to)).toBe(ALLOWED[from].includes(to));
  });

  it("starts runs only where Core creates them", () => {
    expect([...CREATED_AS].sort()).toEqual([...ALLOWED.none].sort());
  });

  it.each(DOMAIN_RUN_STATUSES)("%s means one thing to every reader", (status) => {
    expect({ atWork: isAtWork(status), cameBack: cameBack(status), settled: isSettled(status), final: isFinal(status), open: isOpen(status) }).toEqual(MEANING[status]);
  });

  it("logs an illegal move to refusals.jsonl and still writes it, for this release", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-run-state-"));
    createDomainRun(run("working"), dir);
    updateDomainRun("run-state-1", (current) => ({ ...current, status: "completed" }), dir);
    const saved = updateDomainRun("run-state-1", (current) => ({ ...current, status: "working" }), dir);
    expect(saved?.status).toBe("working");
    expect(readDomainRun("run-state-1", dir)?.status).toBe("working");
    const logged = readFileSync(join(dir, "refusals.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, string>);
    expect(logged).toEqual([expect.objectContaining({ origin: "run-state", reason: "illegal_move", runId: "run-state-1", from: "completed", to: "working" })]);
  });

  it("logs nothing for a legal move or an unchanged status", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-run-state-"));
    createDomainRun(run("queued"), dir);
    updateDomainRun("run-state-1", (current) => ({ ...current, status: "accepted" }), dir);
    updateDomainRun("run-state-1", (current) => ({ ...current, updatedAt: "2026-11-11T01:00:00.000Z" }), dir);
    updateDomainRun("run-state-1", (current) => ({ ...current, status: "completed" }), dir);
    expect(existsSync(join(dir, "refusals.jsonl"))).toBe(false);
  });

  it("logs a run first recorded as already settled", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-run-state-"));
    createDomainRun(run("completed", "run-state-2"), dir);
    expect(readFileSync(join(dir, "refusals.jsonl"), "utf8")).toContain('"from":"none","to":"completed"');
  });
});
