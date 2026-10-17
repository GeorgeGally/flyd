import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const plansDir = join(tmpdir(), `flyd-test-plans-${randomUUID()}`);
const rawDir = join(tmpdir(), `flyd-test-raw-${randomUUID()}`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, PLANS_DIR: plansDir, RAW_DIR: rawDir };
});

vi.mock("../../lib/llm.js", async () => ({
  query: vi.fn().mockResolvedValue(`## Goal
Add user authentication to the API.

## Approach
Use JWT-based auth with refresh tokens stored in the database.

## Files to touch
- src/auth/jwt.ts
- src/middleware/auth.ts

## Implementation steps
- [ ] Step 1: Create JWT utility functions
- [ ] Step 2: Add auth middleware

## Acceptance criteria
- [ ] Users can sign in and get a token
- [ ] Protected routes reject unauthenticated requests`),
}));

vi.mock("../../lib/qmd.js", async () => ({
  search: vi.fn().mockResolvedValue([]),
  updateRaw: vi.fn().mockResolvedValue(undefined),
  embedRaw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../command/coding.js", () => ({ dispatchCodingDomain: vi.fn() }));

beforeEach(() => {
  mkdirSync(plansDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(plansDir, { recursive: true, force: true });
  rmSync(rawDir, { recursive: true, force: true });
});

describe("runPlan", () => {
  it("writes a plan file to PLANS_DIR", async () => {
    const { runPlan } = await import("../plan.js");
    await runPlan("add auth");
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-add-auth-plan\.md$/);
  });

  it("adds frontmatter to the plan file", async () => {
    const { runPlan } = await import("../plan.js");
    await runPlan("user auth");
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    const content = readFileSync(join(plansDir, files[0]), "utf8");
    expect(content).toContain("source: plan");
    expect(content).toContain("type: plan");
    expect(content).toContain("topic: user auth");
    expect(content).toContain("status: draft");
  });

  it("also saves a mirror capture in RAW_DIR", async () => {
    const { runPlan } = await import("../plan.js");
    await runPlan("fix bug");
    const rawFiles = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(rawFiles.length).toBe(1);
    const content = readFileSync(join(rawDir, rawFiles[0]), "utf8");
    expect(content).toContain("source: plan");
    expect(content).toContain("Goal");
  });

  it("creates PLANS_DIR if it does not exist", async () => {
    rmSync(plansDir, { recursive: true, force: true });
    expect(existsSync(plansDir)).toBe(false);
    const { runPlan } = await import("../plan.js");
    await runPlan("test");
    expect(existsSync(plansDir)).toBe(true);
  });

  it("searches memory for relevant context", async () => {
    const qmd = await import("../../lib/qmd.js");
    const { runPlan } = await import("../plan.js");
    await runPlan("memory test");
    expect(qmd.search).toHaveBeenCalledWith("memory test", "flyd-raw", 10);
  });

  it("passes topic to the LLM", async () => {
    const llm = await import("../../lib/llm.js");
    const { runPlan } = await import("../plan.js");
    await runPlan("TypeScript types");
    expect(llm.query).toHaveBeenCalled();
    const prompt = (llm.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prompt).toContain("TypeScript types");
  });

  it("asks for the fixed plan shape, with done_when per phase", async () => {
    const llm = await import("../../lib/llm.js");
    const { runPlan } = await import("../plan.js");
    await runPlan("TypeScript types");
    const prompt = (llm.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
    for (const heading of ["## Outcome", "## Files to touch", "## Approval gates", "**Done when:**", "## Phase 1"]) {
      expect(prompt).toContain(heading);
    }
  });

  it("records the project, repo path, status and created date in the frontmatter", async () => {
    const { runPlan } = await import("../plan.js");
    await runPlan("user auth");
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    const content = readFileSync(join(plansDir, files[0]), "utf8");
    expect(content).toMatch(/^project: .+$/m);
    expect(content).toMatch(/^repo_path: .+$/m);
    expect(content).toMatch(/^status: draft$/m);
    expect(content).toMatch(/^created: \d{4}-\d{2}-\d{2}$/m);
  });

  it("writes only a draft plan and hands nothing off", async () => {
    const coding = await import("../../command/coding.js");
    const { runPlan } = await import("../plan.js");
    await runPlan("ship the plan");
    expect(coding.dispatchCodingDomain).not.toHaveBeenCalled();
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    expect(readFileSync(join(plansDir, files[0]), "utf8")).toContain("status: draft");
  });
});
