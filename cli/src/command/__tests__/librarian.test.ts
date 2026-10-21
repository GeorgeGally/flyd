import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainRun } from "../types.js";

const started: Array<{ task: string; background?: boolean }> = [];
const saved: DomainRun[] = [];
vi.mock("../../runtime/background-jobs.js", () => ({
  MAX_RUNNING_JOBS: 3,
  runningJobs: () => [],
  runJobTurn: vi.fn(),
  verifyJobTurn: vi.fn(),
  listJobs: () => [
    { id: "job-1", status: "ok", result: "retrieved" },
    { id: "job-2", status: "ok", result: "researched" },
  ],
  startBackgroundJob: (contract: { task: string; background?: boolean }) => {
    started.push(contract);
    return `job-${started.length}`;
  },
}));
vi.mock("../store.js", () => ({
  saveDomainRun: (run: DomainRun) => { saved.push(run); },
  listDomainRuns: () => saved.slice(-1),
}));

const { dispatchKnowledgeDomain, syncLibrarianDomainRuns } = await import("../librarian.js");

describe("Librarian specialists", () => {
  beforeEach(() => { started.length = 0; saved.length = 0; });

  it("keeps every specialist of unattended knowledge work unattended, through the fact check", async () => {
    dispatchKnowledgeDomain({ originalMessage: "what changed", intendedOutcome: "what changed", doneWhen: ["answered"], background: true });
    await syncLibrarianDomainRuns();
    expect(started.map((job) => job.background)).toEqual([true, true, true]);
  });

  it("lets knowledge work George asked for open his apps", async () => {
    dispatchKnowledgeDomain({ originalMessage: "what changed", intendedOutcome: "what changed", doneWhen: ["answered"] });
    await syncLibrarianDomainRuns();
    expect(started.map((job) => job.background)).toEqual([undefined, undefined, undefined]);
  });
});
