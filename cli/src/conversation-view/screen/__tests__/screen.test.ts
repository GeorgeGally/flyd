import { describe, expect, it } from "vitest";
import { SCREEN_FIXTURES } from "../fixtures.js";
import { isScreenMeaning, meaningOf, SCREEN_MEANINGS } from "../meaning.js";
import { fillScreen, SCREEN_PATTERNS, screenComplete } from "../patterns.js";
import { reviewScreen, screenTeamLoop } from "../owner.js";

describe("screen meanings", () => {
  it("reads each fixture's meaning from the object, its plan or the runtime's name", () => {
    for (const fixture of SCREEN_FIXTURES) {
      expect(meaningOf(fixture.object, fixture.plan, fixture.named)).toBe(fixture.meaning);
    }
  });

  it("covers the whole typed set with one fixture each", () => {
    expect(SCREEN_FIXTURES.map((fixture) => fixture.meaning).sort()).toEqual([...SCREEN_MEANINGS].sort());
    expect(SCREEN_MEANINGS.every(isScreenMeaning)).toBe(true);
    expect(isScreenMeaning("screen")).toBe(false);
  });

  it("reads a decision with no alternatives as a question of his own", () => {
    const ask = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "ask")!;
    const decision = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "decision")!;
    expect(meaningOf(ask.object)).toBe("ask");
    expect(meaningOf(decision.object)).toBe("decision");
  });
});

describe("screen patterns", () => {
  it("gives every meaning one reviewed pattern with a body", () => {
    for (const meaning of SCREEN_MEANINGS) {
      const pattern = SCREEN_PATTERNS[meaning];
      expect(pattern.meaning).toBe(meaning);
      expect(pattern.body.length).toBeGreaterThan(0);
    }
  });

  it("fills every pattern from its fixture with a body and the action its meaning needs", () => {
    for (const fixture of SCREEN_FIXTURES) {
      const filled = fillScreen(fixture.object, fixture.plan, fixture.named);
      expect(filled.meaning).toBe(fixture.meaning);
      expect(filled.pattern).toBe(SCREEN_PATTERNS[fixture.meaning].id);
      expect(filled.blocks.length).toBeGreaterThan(0);
      expect(screenComplete(filled)).toEqual({ ok: true, missing: [] });
    }
  });

  it("keeps a decision's alternatives as choices, and never invents them", () => {
    const decision = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "decision")!;
    const ask = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "ask")!;
    const chosen = fillScreen(decision.object);
    const asked = fillScreen(ask.object);
    expect(chosen.blocks.find((block) => block.kind === "choices")).toMatchObject({ options: ["Friday", "Saturday"], recommended: "Friday" });
    expect(asked.blocks.some((block) => block.kind === "choices")).toBe(false);
    expect(asked.blocks.find((block) => block.kind === "question")).toMatchObject({ text: "Where is the existing vendor deck?" });
  });

  it("renders a comparison's criteria and both sides, never one alone", () => {
    const comparison = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "comparison")!;
    const filled = fillScreen(comparison.object, comparison.plan);
    const table = filled.blocks.find((block) => block.kind === "comparison");
    expect(table).toMatchObject({ criteria: ["Price", "Setup"] });
    expect((table as { alternatives: unknown[] }).alternatives).toHaveLength(2);
  });

  it("renders an investigation's findings and an artefact's document", () => {
    const result = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "result")!;
    const artefact = SCREEN_FIXTURES.find((fixture) => fixture.meaning === "artefact")!;
    const findings = fillScreen(result.object).blocks.find((block) => block.kind === "findings");
    expect((findings as { items: unknown[] }).items).toHaveLength(2);
    const document = fillScreen(artefact.object).blocks.find((block) => block.kind === "document");
    expect(document).toMatchObject({ text: "The final deck is ready." });
  });

  it("gives an approval its operation and the approve action", () => {
    const approval = {
      ...SCREEN_FIXTURES.find((fixture) => fixture.meaning === "decision")!.object,
      id: "action:send",
      kind: "action" as const,
      subject: "Send the reply to Gareth",
      detail: "The draft is ready to send.",
      action: { phase: "proposed" as const, operation: "Send the drafted WhatsApp reply", category: "outward" as const, requiresApproval: true },
      decision: undefined,
    };
    const filled = fillScreen(approval);
    expect(filled.meaning).toBe("decision");
    expect(filled.action).toBe("approve");
    expect(filled.blocks.find((block) => block.kind === "operation")).toMatchObject({ text: "Send the drafted WhatsApp reply", category: "outward" });
  });
});

describe("screen team", () => {
  it("runs Discover, Define and Deliver for the meaning, and keeps the pattern in Deliver", () => {
    const assignment = { objectId: "task:launch", meaning: "decision" as const, subject: "Choose the launch date" };
    const loop = screenTeamLoop(assignment);
    expect(loop.map((stage) => stage.stage)).toEqual(["discover", "define", "deliver"]);
    expect(loop[2]!.evidence).toContain(`pattern:${SCREEN_PATTERNS.decision.id}`);
    expect(loop[1]!.evidence).toEqual(["desktop", "phone"]);
  });

  it("gates a screen on a body, an action, both viewports and an independent check", () => {
    const fixture = SCREEN_FIXTURES.find((item) => item.meaning === "decision")!;
    const filled = fillScreen(fixture.object);
    expect(reviewScreen(filled).ok).toBe(false);
    expect(reviewScreen(filled).missing).toContain("phone screenshot");
    expect(reviewScreen(filled, { directions: 3, desktop: true, phone: true, independent: true })).toEqual({ ok: true, missing: [] });
  });
});
