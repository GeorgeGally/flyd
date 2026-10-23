import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { serialize } from "../../lib/frontmatter.js";

const plansDir = join(tmpdir(), `flyd-test-work-${randomUUID()}`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, PLANS_DIR: plansDir };
});

vi.mock("../../command/coding.js", () => ({ dispatchCodingDomain: vi.fn() }));

beforeEach(() => {
  mkdirSync(plansDir, { recursive: true });
});

afterEach(() => {
  rmSync(plansDir, { recursive: true, force: true });
});

function writePlan(filename: string, topic: string, steps: string, criteria: string) {
  const content = serialize(
    { source: "plan", type: "plan", topic, status: "draft", project: "test", timestamp: "2026-06-04 12:00:00" },
    `## Goal\nTest ${topic}\n\n## Implementation steps\n${steps}\n\n## Acceptance criteria\n${criteria}`
  );
  writeFileSync(join(plansDir, filename), content, "utf8");
}

describe("runWork", () => {
  it("shows the latest plan when no query given", async () => {
    writePlan("2026-06-04-alpha-plan.md", "alpha", "- [ ] Step 1", "- [ ] Done");
    writePlan("2026-06-04-beta-plan.md", "beta", "- [ ] Step A", "- [ ] Done B");
    const { runWork } = await import("../work.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("beta"));
    log.mockRestore();
  });

  it("lists all plans with --list", async () => {
    writePlan("2026-06-04-a-plan.md", "feature A", "- [ ] x", "- [ ] y");
    writePlan("2026-06-04-b-plan.md", "feature B", "- [ ] x", "- [ ] y");
    const { runWork } = await import("../work.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("--list");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("feature A"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("feature B"));
    log.mockRestore();
  });

  it("finds a plan by filename match", async () => {
    writePlan("2026-06-04-auth-plan.md", "user auth", "- [ ] Add JWT", "- [ ] Login works");
    const { runWork } = await import("../work.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("auth");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("user auth"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Add JWT"));
    log.mockRestore();
  });

  it("finds a plan by topic in frontmatter", async () => {
    writePlan("2026-06-04-abc-plan.md", "payment integration", "- [ ] Stripe", "- [ ] Checkout");
    const { runWork } = await import("../work.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("payment");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("payment integration"));
    log.mockRestore();
  });

  it("prints a message when no plans exist", async () => {
    rmSync(plansDir, { recursive: true, force: true });
    const { runWork } = await import("../work.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no plans found"));
    log.mockRestore();
  });

  it("prints a message when no plan matches", async () => {
    writePlan("2026-06-04-xyz-plan.md", "some topic", "- [ ] x", "- [ ] y");
    const { runWork } = await import("../work.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("nonexistent");
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no plan found matching "nonexistent"'));
    log.mockRestore();
  });
});

function writeShapedPlan(filename: string, topic: string) {
  const content = serialize(
    { source: "plan", type: "plan", topic, status: "draft", project: "flyd", repo_path: "/Users/x/flyd", created: "2026-10-17", timestamp: "2026-10-17 10:00:00" },
    `## Outcome
Add JWT authentication to the API.

## Files to touch
- src/auth/jwt.ts
- src/middleware/auth.ts

## Approval gates
- Landing needs George's /land

## Phase 1 — Token helpers
- [ ] Write the helpers
**Done when:**
- [ ] a test covers a round trip`,
  );
  writeFileSync(join(plansDir, filename), content, "utf8");
}

describe("runWork --start", () => {
  it("hands the plan's task, files and repo folder to a fresh coding session", async () => {
    writeShapedPlan("2026-10-17-auth-plan.md", "user auth");
    const { runWork } = await import("../work.js");
    const dispatch = vi.fn().mockResolvedValue({ status: "accepted", run: {} });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("auth", { start: true, dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const input = dispatch.mock.calls[0][0];
    expect(input.intendedOutcome).toContain("Add JWT authentication to the API.");
    expect(input.intendedOutcome).toContain("- src/auth/jwt.ts");
    expect(input.intendedOutcome).toContain("- src/middleware/auth.ts");
    expect(input.project.root).toBe("/Users/x/flyd");
    expect(input.doneWhen).toEqual(["a test covers a round trip"]);
    log.mockRestore();
  });

  it("says the plan was not started when its repo folder is missing", async () => {
    writeShapedPlan("2026-10-17-auth-plan.md", "user auth");
    const { runWork } = await import("../work.js");
    const dispatch = vi.fn().mockResolvedValue({ status: "refused", reason: "project_not_found" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("auth", { start: true, dispatch });
    expect(log).toHaveBeenCalledWith("not started — /Users/x/flyd doesn't exist");
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("handed to a fresh coding session"));
    log.mockRestore();
  });

  it("never starts work just by showing a plan", async () => {
    writeShapedPlan("2026-10-17-auth-plan.md", "user auth");
    const { runWork } = await import("../work.js");
    const dispatch = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork("auth", { dispatch });
    expect(dispatch).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("asks for a plan to name when none is given", async () => {
    const { runWork } = await import("../work.js");
    const dispatch = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWork(undefined, { start: true, dispatch });
    expect(dispatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("name a plan to start"));
    log.mockRestore();
  });
});
