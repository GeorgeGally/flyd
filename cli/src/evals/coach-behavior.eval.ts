import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { coachSpecialist } from "../runtime/coach-specialist.js";
import {
  configureCoachMemoryDirectory,
  addGoal,
  addPattern,
  listGoals,
} from "../runtime/coach-memory.js";
import {
  configureOutcomeJournalDirectory,
  listJournalEntries,
  recordJournalEntry,
} from "../work-intelligence/outcome-journal.js";

// Behavioral contract: the coach stays grounded, honors corrections for good,
// and compounds what it hears. Scenario-level, not implementation-level.

// Cleanup runs even when assertions fail, so FLYD_DIR and tmp dirs never leak
// into later tests in the same worker.
const pendingTeardowns: Array<() => void> = [];

afterEach(() => {
  for (const teardown of pendingTeardowns.splice(0)) teardown();
});

interface CoachFixture {
  dispatch: (message: string) => Promise<string | null>;
  modelCalls: () => string[];
}

function coachFixture(respond?: (prompt: string) => string): CoachFixture {
  const root = join(tmpdir(), `flyd-eval-coach-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  const prevFlydDir = process.env.FLYD_DIR;
  process.env.FLYD_DIR = root;
  configureCoachMemoryDirectory(join(root, "coach"));
  configureOutcomeJournalDirectory(join(root, "overlay", "founder-journal"));

  const calls: string[] = [];
  pendingTeardowns.push(() => {
    if (prevFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = prevFlydDir;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });
  const specialist = coachSpecialist({
    queryText: async (prompt) => {
      calls.push(prompt);
      return respond ? respond(prompt) : "Grounded coaching reply.";
    },
    model: { model: "fixture-model", apiKey: "fixture-key" },
  });

  return {
    modelCalls: () => calls,
    async dispatch(message) {
      return specialist.dispatch({ message });
    },
  };
}

describe("coach behavior", () => {
  it("honors a correction permanently — a dropped goal stops surfacing", async () => {
    const coach = coachFixture();
    addGoal("Ship GNM sponsor outreach", "user");
    addPattern("Overcommits to outreach", "inferred", "retrospective");
    recordJournalEntry({
      entryId: `j-${randomUUID()}`,
      interactionId: "eval",
      workSessionId: "eval",
      timestamp: new Date().toISOString(),
      eventType: "coach_checkin",
      details: {},
    });

    const reply = await coach.dispatch("a friend is handling sponsor outreach, take it off my plate");
    expect(reply ?? "").toContain("stop re-surfacing");
    expect(listGoals()).toHaveLength(0);

    // next session: the dropped goal must not leak back into grounding
    await coach.dispatch("what should I focus on?");
    expect(coach.modelCalls().length).toBeGreaterThan(0);
    const groundingPrompt = coach.modelCalls().at(-1)!;
    expect(groundingPrompt).not.toContain("GNM sponsor outreach");
  });

  it("refuses to give generic advice when it has no grounding", async () => {
    const coach = coachFixture();

    const reply = await coach.dispatch("help me be more productive");

    expect(reply).toContain("I need more grounding");
    expect(coach.modelCalls()).toHaveLength(0);
  });

  it("compounds check-ins into the journal", async () => {
    const coach = coachFixture(() =>
      "Focus is the outreach draft; blocker is drafting speed. Noted."
    );

    const reply = await coach.dispatch("check in — focus is outreach, blocker is drafting");

    expect((reply ?? "").toLowerCase()).toContain("outreach");
    const checkins = listJournalEntries({ eventTypes: ["coach_checkin"] });
    expect(checkins.length).toBeGreaterThan(0);
  });

  it("never lets markdown or HTML reach the chat surface", async () => {
    const coach = coachFixture(() =>
      "<strong>Coach:</strong> **one thing** — stop rewriting the outline."
    );
    addGoal("Finish Q3 plan", "user");

    const reply = await coach.dispatch("what's blocking my Q3 plan?");

    expect(reply).not.toMatch(/<[^>]+>|\*\*/);
  });
});
