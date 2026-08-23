import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { coachSpecialist, routeCoachSkill, coachSkills } from "../coach-specialist.js";
import {
  configureCoachMemoryDirectory,
  addGoal,
  addPattern,
} from "../coach-memory.js";
import {
  configureOutcomeJournalDirectory,
  recordJournalEntry,
  listJournalEntries,
} from "../../work-intelligence/outcome-journal.js";

describe("coach specialist", () => {
  let root: string;
  let prevFlydDir: string | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `flyd-coach-spec-${randomUUID()}`);
    prevFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = root;
    mkdirSync(root, { recursive: true });
    configureCoachMemoryDirectory(join(root, "coach"));
    configureOutcomeJournalDirectory(join(root, "overlay", "founder-journal"));
  });

  afterEach(() => {
    if (prevFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = prevFlydDir;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("returns one grounded, non-generic intervention when sufficient data exists", async () => {
    addGoal("Ship the sponsor outreach", "user");
    addPattern("Defers hard conversations", "inferred", "retrospective");
    recordJournalEntry({
      entryId: `checkin-${randomUUID()}`,
      interactionId: randomUUID(),
      workSessionId: randomUUID(),
      timestamp: new Date().toISOString(),
      eventType: "coach_checkin",
      details: { focus: "outreach", blockers: "drafting" },
    });

    const queryText = vi.fn(async (_prompt, _model, system) => {
      expect(system).toContain("never give generic advice");
      return "You committed to GNM sponsor outreach. The blocker is drafting — start with one email template today, not the full list.";
    });

    const coach = coachSpecialist({
      queryText,
      model: { model: "test-model", apiKey: "k", baseURL: "https://x" },
    });

    const reply = await coach.dispatch({
      message: "coach, I'm stuck on outreach",
      presentHypothesis: "Working on GNM sponsor outreach",
    });

    expect(reply).toContain("GNM sponsor outreach");
    expect(reply).toContain("one");
    expect(queryText).toHaveBeenCalledTimes(1);
  });

  it("refuses to coach with insufficient grounding rather than give generic advice", async () => {
    const queryText = vi.fn(async () => "should not be called");
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    const reply = await coach.dispatch({ message: "coach, help me be more productive" });

    expect(reply).toContain("I need more grounding");
    expect(reply).toContain("generic advice");
    expect(queryText).not.toHaveBeenCalled();
  });

  it("includes known goals and patterns in the grounding prompt", async () => {
    addGoal("Grow CleanX", "user");
    addPattern("Starts too many projects", "correction", "user");

    const queryText = vi.fn(async (_prompt) => "grounded reply");
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    await coach.dispatch({ message: "coach, what next?" });

    const prompt = queryText.mock.calls[0][0] as string;
    expect(prompt).toContain("Grow CleanX");
    expect(prompt).toContain("Starts too many projects");
  });

  it("routes a 'check in' message to the check-in skill and journals a receipt", async () => {
    const queryText = vi.fn(async (prompt) => {
      expect(prompt).toContain("User check-in");
      return "Got it — you're focused on outreach and the blocker is drafting. I won't re-ask.";
    });
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    const reply = await coach.dispatch({
      message: "check in — focus is outreach, blocker is drafting",
      presentHypothesis: "GNM outreach",
    });

    expect(reply).toContain("outreach");
    const checkins = listJournalEntries({ eventTypes: ["coach_checkin"] });
    expect(checkins.length).toBeGreaterThan(0);
  });

  it("routes a retrospective message to the retrospective skill and journals a receipt", async () => {
    const queryText = vi.fn(async () => "What was offered: outreach draft. What happened: nothing. Pattern: needs external accountability.");
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    await coach.dispatch({ message: "retro — how did the outreach draft go?" });

    const retros = listJournalEntries({ eventTypes: ["coach_retrospective"] });
    expect(retros.length).toBeGreaterThan(0);
  });

  it("records a goal when the user asks to adjust or set one", async () => {
    const coach = coachSpecialist({ model: { model: "m", apiKey: "k" } });
    const reply = await coach.dispatch({
      message: "new goal: get GNM sponsors signed by end of month",
    });
    expect(reply).toContain("GNM sponsors signed by end of month");
  });

  it("coach skills carry an eval contract with the no-generic hard-fail", () => {
    const skills = coachSkills();
    for (const skill of skills) {
      expect(skill.contract.goal.length).toBeGreaterThan(0);
      expect(skill.contract.dimensions.length).toBeGreaterThan(0);
    }
    const diagnose = skills.find((s) => s.name === "diagnose");
    expect(diagnose?.contract.hardFails.some((h) => /grounded/i.test(h))).toBe(true);
  });

  it("strips markdown/HTML from the coach reply so the CLI chat stays clean", async () => {
    addGoal("Ship outreach", "user");
    const queryText = vi.fn(async () =>
      "<strong>Coach:</strong> You are **using** `Flyd` work to stay near the work\n## instead of doing it.",
    );
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    const reply = await coach.dispatch({
      message: "coach, what's going on with outreach?",
      presentHypothesis: "Working on outreach",
    });

    expect(reply).not.toContain("<strong>");
    expect(reply).not.toContain("**");
    expect(reply).not.toContain("`");
    expect(reply).not.toContain("##");
    expect(reply).toContain("You are using Flyd work to stay near the work");
  });

  it("routes by trigger substring, falling back to the diagnose skill", () => {
    expect(routeCoachSkill("let's do a quick check in")?.name).toBe("check_in");
    expect(routeCoachSkill("update my goal: ship it")?.name).toBe("goal_adjust");
    expect(routeCoachSkill("coach, what should I focus on")).toBeUndefined();
  });

  it("archives a goal when the user takes it off their plate", async () => {
    addGoal("Ship GNM sponsor outreach", "user");
    const queryText = vi.fn(async () => "should not reach diagnose after a successful drop");
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    const reply = await coach.dispatch({
      message: "a friend is handling sponsor outreach, so I can take that off my plate",
    });

    expect(reply).toContain("GNM sponsor outreach");
    expect(reply).toContain("stop re-surfacing");
    expect(queryText).not.toHaveBeenCalled();
    // goal is archived: no longer active
    const { listGoals } = await import("../coach-memory.js");
    expect(listGoals()).toHaveLength(0);
  });

  it("falls through to diagnose when a drop trigger matches but no goal matches", async () => {
    addGoal("Ship CleanX", "user");
    addPattern("Spreads focus", "inferred", "retrospective");
    const queryText = vi.fn(async () => "coached reply about CleanX");
    const coach = coachSpecialist({ queryText, model: { model: "m", apiKey: "k" } });

    const reply = await coach.dispatch({
      message: "I'm done with sponsorship, what should I focus on?",
    });

    // 'done with' matches drop trigger, but no goal mentions sponsorship → fall through
    expect(queryText).toHaveBeenCalledTimes(1);
    expect(reply).toContain("coached reply");
  });
});
