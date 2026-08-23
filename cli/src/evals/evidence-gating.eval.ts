import { describe, expect, it } from "vitest";
import { buildResolutionPrompt, routeIntent } from "../resolve.js";
import type { IntelligenceState } from "../export-state.js";
import {
  classifyEvidenceNeed,
  parseResolutionEvidenceContext,
} from "../evidence/evidence-need.js";
import { nonEditableEnvironment } from "./helpers.js";

// Behavioral contract: when research triggers, when it must refuse to invent
// certainty, and the real prompt format never drifts out from under gating.
//
// The world state is a fixed empty profile so gating evals are deterministic
// across machines — FLYD_DIR is frozen at import time, so runtime env vars
// cannot isolate buildIntelligenceState() from a real wiki.

function emptyWorldState(): IntelligenceState {
  return {
    version: "1.0",
    generatedAt: "2026-08-23T00:00:00.000Z",
    source: "flyd-cli",
    goals: [],
    tensions: [],
    signals: [],
    curiosity: [],
    nudges: [],
    reports: [],
    recentEvents: [],
    brainHealth: [],
    profile: [],
    knowledge: [],
    review: [],
    suggestions: [],
    capabilities: [],
  };
}

function gateForIntent(intent: string) {
  const environment = nonEditableEnvironment();
  const route = routeIntent(intent, environment, "text");
  const prompt = buildResolutionPrompt(emptyWorldState(), environment, intent, route);
  const context = parseResolutionEvidenceContext(prompt);
  expect(context, `prompt for "${intent}" must stay parseable by the evidence gate`).toBeTruthy();
  return classifyEvidenceNeed(context!);
}

describe("evidence gating", () => {
  it("requires evidence for current-events questions through the REAL resolution prompt", () => {
    const decision = gateForIntent("What did Vercel announce this week?");
    expect(decision.level).toBe("required");
    expect(decision.query.toLowerCase()).toContain("vercel");
  });

  it("never browses for draft/edit work on focused text", () => {
    const decision = gateForIntent("fix the grammar and polish this paragraph");
    expect(decision.level).toBe("none");
  });

  it("escalates explicit deep research to a composed dossier", () => {
    const decision = classifyEvidenceNeed({
      intent: "do deep research on solid state batteries versus hydrogen fuel cells",
      routeKind: "ask_answer",
      locators: [],
    });
    expect(decision.level).toBe("required");
    expect(decision.depth).toBe("deep");
    expect(decision.manifestation).toBe("compose");
  });

  it("fails closed on volatile facts with no locator — never answers from stale certainty", () => {
    const decision = classifyEvidenceNeed({
      intent: "is the iPhone in stock at the store right now",
      routeKind: "ask_answer",
      locators: [],
    });
    // required or recommended is acceptable; "none" would mean inventing certainty
    expect(decision.level === "required" || decision.level === "recommended").toBe(true);
  });

  it("keeps personal recall off the network", () => {
    const decision = classifyEvidenceNeed({
      intent: "what am I working on today?",
      routeKind: "ask_answer",
      locators: [],
    });
    expect(decision.level).toBe("none");
  });
});
