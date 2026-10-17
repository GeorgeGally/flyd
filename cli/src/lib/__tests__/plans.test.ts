import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serialize } from "../frontmatter.js";
import { findPlan, parsePlanBody, planHandoff, readPlans } from "../plans.js";

const PLAN_BODY = `## Outcome
Add JWT authentication to the API.

## Files to touch
- src/auth/jwt.ts — the token helpers
- src/middleware/auth.ts — the guard

## Approval gates
- Landing needs George's /land
- Sending the invite email needs his yes

## Phase 1 — Token helpers
- [ ] Write the sign and verify functions
- [ ] Add a unit test
**Done when:**
- [ ] a test covers a round trip
- [ ] an expired token is rejected

## Phase 2 — Guard
- [ ] Add the middleware
**Done when:**
- [ ] protected routes reject an unauthenticated request`;

function writePlan(dir: string, filename: string, topic: string, body = PLAN_BODY): void {
  const content = serialize(
    { source: "plan", type: "plan", topic, status: "draft", project: "flyd", repo_path: "/Users/x/flyd", created: "2026-10-17", timestamp: "2026-10-17 10:00:00" },
    body,
  );
  writeFileSync(join(dir, filename), content, "utf8");
}

describe("parsePlanBody", () => {
  it("reads the fixed shape: outcome, files, approval gates and per-phase done_when", () => {
    const parsed = parsePlanBody(PLAN_BODY);
    expect(parsed.outcome).toBe("Add JWT authentication to the API.");
    expect(parsed.files).toEqual(["src/auth/jwt.ts — the token helpers", "src/middleware/auth.ts — the guard"]);
    expect(parsed.approvalGates).toEqual(["Landing needs George's /land", "Sending the invite email needs his yes"]);
    expect(parsed.phases).toEqual([
      { title: "Token helpers", steps: ["Write the sign and verify functions", "Add a unit test"], doneWhen: ["a test covers a round trip", "an expired token is rejected"] },
      { title: "Guard", steps: ["Add the middleware"], doneWhen: ["protected routes reject an unauthenticated request"] },
    ]);
  });

  it("accepts plain bullets for steps and done_when points", () => {
    const parsed = parsePlanBody("## Phase 1 — Helpers\nRead the code first\n- Write the helper\n**Done when:**\n- a test passes");
    expect(parsed.phases).toEqual([{ title: "Helpers", steps: ["Read the code first", "Write the helper"], doneWhen: ["a test passes"] }]);
  });

  it("gives empty parts rather than throwing on an old or empty body", () => {
    expect(parsePlanBody("## Goal\nSomething.\n\n## Acceptance criteria\n- [ ] done")).toEqual({ outcome: "", files: [], approvalGates: [], phases: [] });
    expect(parsePlanBody("")).toEqual({ outcome: "", files: [], approvalGates: [], phases: [] });
  });
});

describe("readPlans", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-plans-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a plan file with its frontmatter and its shape, newest first", () => {
    writePlan(dir, "2026-10-16-older-plan.md", "older");
    writePlan(dir, "2026-10-17-newer-plan.md", "newer");
    const plans = readPlans(dir);
    expect(plans.map((plan) => plan.filename)).toEqual(["2026-10-17-newer-plan.md", "2026-10-16-older-plan.md"]);
    expect(plans[0]).toMatchObject({
      topic: "newer",
      status: "draft",
      project: "flyd",
      repoPath: "/Users/x/flyd",
      created: "2026-10-17",
      outcome: "Add JWT authentication to the API.",
      files: ["src/auth/jwt.ts — the token helpers", "src/middleware/auth.ts — the guard"],
    });
    expect(plans[0]!.phases[0]!.doneWhen).toEqual(["a test covers a round trip", "an expired token is rejected"]);
  });

  it("returns nothing for a missing folder", () => {
    expect(readPlans(join(dir, "absent"))).toEqual([]);
  });
});

describe("findPlan", () => {
  it("finds by filename then by topic", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-plans-find-"));
    try {
      writePlan(dir, "2026-10-17-auth-plan.md", "user auth");
      expect(findPlan("2026-10-17-auth", dir)?.topic).toBe("user auth");
      expect(findPlan("user auth", dir)?.filename).toBe("2026-10-17-auth-plan.md");
      expect(findPlan("nothing like it", dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("planHandoff", () => {
  it("hands over the task, the files, the repo folder and the first phase's done_when", () => {
    const handoff = planHandoff({
      path: "/x", filename: "f.md", topic: "auth", status: "draft", project: "flyd", repoPath: "/Users/x/flyd", created: "2026-10-17", body: "",
      outcome: "Add JWT authentication to the API.",
      files: ["src/auth/jwt.ts", "src/middleware/auth.ts"],
      approvalGates: ["Landing needs George's /land"],
      phases: [
        { title: "Token helpers", steps: ["Write the sign and verify functions"], doneWhen: ["a test covers a round trip"] },
        { title: "Guard", steps: ["Add the middleware"], doneWhen: ["protected routes reject an unauthenticated request"] },
      ],
    });
    expect(handoff.originalMessage).toBe("auth");
    expect(handoff.intendedOutcome).toContain("Add JWT authentication to the API.");
    expect(handoff.intendedOutcome).toContain("Phase 1 — Token helpers");
    expect(handoff.intendedOutcome).toContain("- Write the sign and verify functions");
    expect(handoff.intendedOutcome).not.toContain("Add the middleware");
    expect(handoff.project).toEqual({ name: "flyd", root: "/Users/x/flyd" });
    expect(handoff.intendedOutcome).toContain("- src/auth/jwt.ts");
    expect(handoff.intendedOutcome).toContain("- src/middleware/auth.ts");
    expect(handoff.project.root).toBe("/Users/x/flyd");
    expect(handoff.doneWhen).toEqual(["a test covers a round trip"]);
  });

  it("falls back to the topic and to every phase's points when a plan is incomplete", () => {
    const handoff = planHandoff({
      path: "/x", filename: "f.md", topic: "tidy the repo", status: "draft", project: "", repoPath: "/x", created: "", body: "",
      outcome: "", files: [], approvalGates: [], phases: [{ title: "One", steps: [], doneWhen: ["a", "b"] }],
    });
    expect(handoff.originalMessage).toBe("tidy the repo");
    expect(handoff.doneWhen).toEqual(["a", "b"]);
  });
});
