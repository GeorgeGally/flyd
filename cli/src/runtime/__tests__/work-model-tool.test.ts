import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../../work/database.js";
import type { WorkHypothesis, WorkThread } from "../../work/work-hypothesis/types.js";
import { runAssistantTool } from "../assistant-tools.js";
import { chatToolSet } from "../conversation-responder.js";
import { isMutatingToolCall } from "../personal-tools.js";
import { contractError } from "../tool-contracts.js";
import { classifyToolCall } from "../tool-policy.js";
import { offRoute, planTurn, TURN_ROUTES } from "../turn-plan.js";
import { parseWorkModelArgs, rankWorkModel, workModelTool } from "../work-model-tool.js";

const now = new Date("2026-10-12T12:00:00Z");

function thread(name: string, extra: Partial<WorkThread> = {}): WorkThread {
  return { root: `/repos/${name.toLowerCase()}`, name, isDirty: false, hasTasks: false, isForeground: false, signals: [], demoted: false, ...extra };
}

function hypothesis(primary: WorkThread[], secondary: WorkThread[] = []): WorkHypothesis {
  return {
    epistemicClass: "inference", id: "h1", hypothesisText: "", primaryThreads: primary, secondaryThreads: secondary,
    confidence: "medium", uncertainty: [], evidenceRefs: [], demotions: [], revisedAt: now.toISOString(), generatedAt: now.toISOString(), fromCache: true,
  };
}

describe("work_model tool contract", () => {
  it("names the work-status questions it serves", () => {
    for (const intent of ["what should I work on", "my top priorities", "what's next", "work model"]) {
      expect(workModelTool.description.toLowerCase()).toContain(intent.toLowerCase());
    }
    expect(Object.keys(workModelTool.input_schema.properties)).toEqual(["action", "statement", "limit", "topics"]);
  });

  it("checks its arguments before it runs, with an error the model can act on", () => {
    expect(parseWorkModelArgs({})).toEqual({ args: { action: "show", statement: "", limit: 5, topics: [] } });
    expect(parseWorkModelArgs({ statement: "CleanX is done" })).toEqual({ args: { action: "correct", statement: "CleanX is done", limit: 5, topics: [] } });
    expect(parseWorkModelArgs({ action: "show", limit: 3, topics: [" Flyd "] })).toEqual({ args: { action: "show", statement: "", limit: 3, topics: ["Flyd"] } });
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ action: "rank" }, /action must be "show" or "correct"/],
      [{ action: "correct" }, /action=correct needs George's statement/],
      [{ limit: 0 }, /limit must be a whole number from 1 to 10 \(got 0\)/],
      [{ limit: 2.5 }, /limit must be a whole number/],
      [{ limit: "3" }, /limit must be a whole number/],
      [{ topics: "Flyd" }, /topics must be a list/],
      [{ topics: ["Flyd", ""] }, /topics must be a list/],
      [{ statement: 42 }, /statement must be text/],
      [{ query: "priorities" }, /"query" is not one of them/],
    ];
    for (const [input, error] of bad) {
      const parsed = parseWorkModelArgs(input);
      expect("error" in parsed && parsed.error).toMatch(/^Error: work_model /);
      expect("error" in parsed && parsed.error).toMatch(error);
      // The harness gate stops it before the tool body runs.
      expect(contractError("work_model", input)).toMatch(error);
    }
    expect(contractError("work_model", { action: "show", limit: 3 })).toBeNull();
  });

  it("ranks main threads before side ones, each with a short reason, never demoted ones", () => {
    const items = rankWorkModel(hypothesis(
      [thread("Flyd", { isForeground: true, lastCommitAt: "2026-10-11T09:00:00Z", latestSubject: "work_model contract", hasTasks: true })],
      [thread("CleanX", { lastCommitAt: "2026-10-05T09:00:00Z", isDirty: true }), thread("Bridgestone", { demoted: true })],
    ), { now });
    expect(items).toEqual([
      { rank: 1, name: "Flyd", reason: "a main thread; open in front of him; last commit yesterday: work_model contract; open tasks" },
      { rank: 2, name: "CleanX", reason: "on the side; last commit 7 days ago; uncommitted changes" },
    ]);
    const twoMain = hypothesis([thread("Flyd"), thread("Bloom")], [thread("CleanX")]);
    expect(rankWorkModel(twoMain, { limit: 1, now }).map((item) => item.name)).toEqual(["Flyd"]);
    expect(rankWorkModel(twoMain, { topics: ["cleanx"], now })).toEqual([{ rank: 1, name: "CleanX", reason: "on the side" }]);
    expect(rankWorkModel(null)).toEqual([]);
  });

  it("reads without changing anything, so it is fine on an answer turn; a correction is a change", () => {
    expect(classifyToolCall("work_model", { action: "show" })).toBe("read");
    expect(isMutatingToolCall("work_model", { action: "show" })).toBe(false);
    expect(classifyToolCall("work_model", { statement: "I'm not working on Bridgestone anymore" })).toBe("local");
    expect(isMutatingToolCall("work_model", { statement: "I'm not working on Bridgestone anymore" })).toBe(true);
  });
});

describe("work_model in chat", () => {
  it("is in the default chat tool set on every turn that shows tools beyond the hand-offs", () => {
    const shown = (plan: ReturnType<typeof planTurn>) => chatToolSet(plan, false).map((tool) => tool.name);
    expect(shown(null)).toContain("work_model");
    for (const route of TURN_ROUTES.filter((route) => route !== "delegate")) {
      const names = shown(planTurn({ route, source: "jev" }));
      expect(names, route).toContain("work_model");
      // Offered alongside the tools it was losing to.
      expect(names, route).toEqual(expect.arrayContaining(["email_search", "recall"]));
    }
    expect(chatToolSet(planTurn({ route: "answer", source: "jev" }), true).map((tool) => tool.name)).toEqual(expect.arrayContaining(["work_model", "bash"]));
  });

  it("lets George's own correction through on an answer turn", () => {
    const answer = planTurn({ route: "answer", source: "jev" });
    expect(offRoute(answer, "work_model", { statement: "I'm not working on Bridgestone anymore" })).toBeNull();
    expect(offRoute(answer, "work_model", { action: "show" })).toBeNull();
    expect(offRoute(answer, "remember", { text: "x" })).toMatch(/^Skipped/);
  });

  describe("returns structured ranked output", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "flyd-work-model-tool-"));
      useWorkIndexPath(join(dir, "work-index.sqlite"));
    });
    afterEach(() => {
      closeDb();
      resetWorkIndexPath();
      rmSync(dir, { recursive: true, force: true });
    });

    it("shows an empty ranked list rather than free text when there is no picture yet", async () => {
      expect(JSON.parse(await runAssistantTool("work_model", { action: "show" }))).toEqual({ items: [], note: "Flyd has no picture of his work yet" });
      expect(await runAssistantTool("work_model", { action: "show", limit: 99 })).toMatch(/^Error: work_model limit/);
    });
  });
});
