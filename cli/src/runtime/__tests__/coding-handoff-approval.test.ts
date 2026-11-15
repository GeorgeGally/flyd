import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The crew is never launched from a test: dispatch is recorded instead.
const dispatched = vi.hoisted(() => [] as Array<{ outcome: string; afterLand?: string[] }>);
vi.mock("../../crew/crew.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../crew/crew.js")>();
  return {
    ...actual,
    dispatchCrewTask: vi.fn(async (options: { repo: string; outcome: string; afterLand?: string[] }) => {
      dispatched.push({ outcome: options.outcome, ...(options.afterLand?.length ? { afterLand: options.afterLand } : {}) });
      return { id: "task-1", repo: options.repo } as never;
    }),
    deployCommand: () => "npm run deploy",
  };
});

const { respondToConversation } = await import("../conversation-responder.js");

beforeEach(() => {
  dispatched.length = 0;
  vi.stubEnv("FLYD_ROOM", "0");
  // The compatibility crew path, so nothing reaches a real FirstMate home.
  vi.stubEnv("FLYD_FIRSTMATE", "0");
});
afterEach(() => { vi.unstubAllEnvs(); });
vi.setConfig({ testTimeout: 20_000 });

async function callTool(input: Record<string, unknown>, root: string, askUser?: (prompt: string) => Promise<boolean | "always">): Promise<string> {
  let result = "";
  await respondToConversation({
    message: "still getting an error on the extension",
    history: [],
    memory: { verdict: "insufficient", matches: [] },
    situation: {
      project: "guido", branch: "main", head: "abc123", dirty: false,
      changedFiles: 0, latestCommit: null, outcome: null, status: null, nextAction: null,
      projectRoot: realpathSync(root),
    },
    onToken: () => undefined,
    ...(askUser ? { askUser } : {}),
  }, {
    runAgentLoop: async (_system, _prompt, _tools, onToolCall) => {
      result = await onToolCall("start_coding_task", input);
      return "<final>done</final>";
    },
    persistReceipt: async (receipt) => receipt as never,
  });
  return result;
}

describe("a coding request never waits on a push approval", () => {
  it("starts the Guido fix at once in a window that cannot ask George, push included", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-guido-"));
    try {
      // The exact call that came back "Not approved" and left the fix unstarted.
      const out = await callTool({
        repo: root,
        outcome: "Fix the Guido extension error that still appears when using it.",
        done_when: ["No extension error appears on a sitemap.xml page"],
        after_land: ["Push the fix to GeorgeGally/guido on GitHub"],
      }, root);
      expect(out).not.toMatch(/Not approved/);
      expect(out).toMatch(/^Started/);
      expect(dispatched).toEqual([{ outcome: "Fix the Guido extension error that still appears when using it." }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never asks George about a routine push", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-guido-"));
    const asked: string[] = [];
    try {
      const out = await callTool({ repo: root, outcome: "Fix the ruler error", done_when: ["x"], after_land: ["push"] }, root,
        async (prompt) => { asked.push(prompt); return false; });
      expect(asked).toEqual([]);
      expect(out).toMatch(/^Started/);
      expect(dispatched).toEqual([{ outcome: "Fix the ruler error", afterLand: ["push"] }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds only the deploy step when it isn't approved, and says the build started", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-guido-"));
    try {
      const out = await callTool({ repo: root, outcome: "Fix the ruler error", done_when: ["x"], after_land: ["push", "deploy"] }, root);
      expect(dispatched).toEqual([{ outcome: "Fix the ruler error", afterLand: ["push"] }]);
      expect(out).toMatch(/^Started/);
      expect(out).toMatch(/Only this step is held: .*deploy/);
      expect(out).toMatch(/there was no way to ask George here/);
      expect(out).not.toMatch(/George did not approve/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
