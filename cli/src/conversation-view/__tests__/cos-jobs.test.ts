import { describe, expect, it } from "vitest";
import type { Objective, CosReport } from "../../command/cos/types.js";
import type { DomainRun } from "../../command/types.js";
import { jobsFrom } from "../jobs.js";
import { cosDecisionRun, cosJobRuns, cosRequestIds } from "../cos-jobs.js";

const at = "2026-11-01T00:00:00Z";
const now = Date.parse("2026-11-27T00:00:00Z");
const objective: Objective = {
  id: "obj-one", revision: 1, createdAt: at, updatedAt: at, origin: { surface: "chat" }, words: "Build the page", flydNotes: "", contextRefs: [],
  status: "needs_george", runs: ["run-one"], reportIds: ["report-one"],
  waitingOn: { reportId: "report-one", kind: "run", question: "Which colour?", options: ["Blue", "Green"], at },
};
const report: CosReport = { id: "report-one", objectiveId: "obj-one", kind: "decision", outcome: "A colour needs your choice", detail: "Blue or green.", options: ["Blue", "Green"], evidenceRefs: ["domain-run:run-one"], shape: "words", artefacts: [], urgency: "whenever" };
const run: DomainRun = {
  id: "run-one", owner: "FirstMate", status: "needs_decision", createdAt: at, updatedAt: at,
  request: { id: "run-one", domain: "coding", originalMessage: "Build the page", intendedOutcome: "Raw internal brief", doneWhen: [], createdAt: at, objectiveId: "obj-one" },
  transport: { kind: "firstmate", requestId: "run-one" },
};

describe("chief-of-staff jobs", () => {
  it("projects the reviewed question once, preserving its identity, options and old unanswered decisions", () => {
    const projected = cosJobRuns([run], [objective], [report], now);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ id: "obj-one", question: "Which colour?", options: ["Blue", "Green"], persistentDecision: true });
    const board = jobsFrom({ runs: projected, now });
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0]).toMatchObject({ group: "needs", domainRun: "obj-one", ask: "Which colour?", choices: ["Blue", "Green"] });
  });

  it("keeps legacy records and withholds unreviewed team reports", () => {
    const other = { ...run, id: "legacy", request: { ...run.request, id: "legacy", objectiveId: undefined } };
    expect(cosJobRuns([run, other], [objective], [], now).map((item) => item.id)).toEqual(["legacy", "obj-one"]);
    expect(cosJobRuns([run, other], [objective], [], now).find((item) => item.id === "obj-one")).toMatchObject({ status: "incomplete", outcome: "Build the page" });
    expect(cosJobRuns([run, other], [objective], [{ ...report, objectiveId: "obj-other" }], now).map((item) => item.id)).toEqual(["legacy", "obj-one"]);
    expect(cosRequestIds([run, other], [objective])).toEqual(new Set(["run-one"]));
    expect(cosJobRuns([run], [], [], now)[0]).toMatchObject({ id: "obj-one", status: "incomplete", outcome: "Build the page" });
  });

  it("groups several active team runs under their one objective", () => {
    const other = { ...run, id: "run-two", request: { ...run.request, id: "run-two", intendedOutcome: "Unreviewed team update" } };
    const active = { ...objective, status: "working" as const, waitingOn: undefined, runs: ["run-one", "run-two"], updatedAt: new Date(now).toISOString() };
    const projected = cosJobRuns([run, other], [active], [], now);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ id: "obj-one", outcome: "Build the page", status: "working" });
    expect(cosJobRuns([run, other], [active], [], now, false)[0]).toMatchObject({ id: "obj-one", status: "incomplete" });
  });

  it("recognizes a durable dispatch while the domain receipt is not yet written", () => {
    const dispatching = { ...objective, status: "working" as const, waitingOn: undefined, runs: [], plan: [
      { key: "r1", team: "coding" as const, outcome: "Build the page", doneWhen: ["done"], state: "dispatching" as const, attempt: 1, validFor: 0 },
    ] };
    expect(cosRequestIds([], [dispatching])).toEqual(new Set(["obj-one-r1"]));
  });

  it("targets only the run named by the objective's own reviewed report", () => {
    const multi = { ...objective, runs: ["run-one", "run-two"] };
    expect(cosDecisionRun(multi, [report])).toBe("run-one");
    expect(cosDecisionRun(multi, [{ ...report, evidenceRefs: ["domain-run:run-one", "domain-run:run-two"] }])).toBeUndefined();
    expect(cosDecisionRun(multi, [{ ...report, objectiveId: "obj-other" }])).toBeUndefined();
  });

  it("keeps identical questions on different objectives independently answerable", () => {
    const other = { ...objective, id: "obj-two", reportIds: ["report-two"], waitingOn: { ...objective.waitingOn!, reportId: "report-two" } };
    const otherReport = { ...report, id: "report-two", objectiveId: "obj-two" };
    const board = jobsFrom({ runs: cosJobRuns([run], [objective, other], [report, otherReport], now), now });
    expect(board.jobs.map((job) => job.domainRun).sort()).toEqual(["obj-one", "obj-two"]);
  });

  it("does not surface a snoozed decision as an answer needed now", () => {
    const snoozed = { ...objective, snooze: { until: "2026-11-28T00:00:00Z", at } };
    const board = jobsFrom({ runs: cosJobRuns([run], [snoozed], [report], now), now });
    expect(board.jobs.every((job) => job.group !== "needs")).toBe(true);
  });

  it("keeps a reviewed completion visible even when no project was named", () => {
    const done = { ...objective, status: "done" as const, waitingOn: undefined, updatedAt: new Date(now).toISOString() };
    const finished = { ...report, kind: "done" as const, outcome: "The page is ready", detail: "Completed the page." };
    const board = jobsFrom({ runs: cosJobRuns([run], [done], [finished], now), now });
    expect(board.jobs[0]).toMatchObject({ group: "done", next: "The page is ready" });
  });
});
