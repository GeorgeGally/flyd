import type { ManifestationPlan, SemanticObject } from "../semantic.js";
import type { ScreenMeaning } from "./meaning.js";

/**
 * One real fixture per meaning: the object the pattern is designed against and
 * the plan a shaped answer declares. A new pattern is reviewed against its
 * fixture (a design lab, when it needs directions), and the runtime test fills every pattern from it.
 */
export interface ScreenFixture {
  meaning: ScreenMeaning;
  object: SemanticObject;
  plan?: ManifestationPlan;
  named?: ScreenMeaning;
}

const base = {
  evidence: [] as SemanticObject["evidence"],
  actions: [] as SemanticObject["actions"],
  source: { showItemId: "fixture" },
};

export const SCREEN_FIXTURES: ScreenFixture[] = [
  {
    meaning: "answer",
    object: {
      ...base,
      id: "message:answer",
      kind: "conversation",
      lifecycle: "active",
      subject: "Shippo is the cheaper one at your volume",
      summary: "Under 500 labels a month, Shippo's per-label rate wins.",
      detail: "Under 500 labels a month, Shippo's per-label rate wins; Unified.to pays off past 2,000.",
      createdAt: "2026-10-22T08:00:00.000Z",
    },
  },
  {
    meaning: "decision",
    object: {
      ...base,
      id: "task:launch",
      kind: "decision",
      lifecycle: "interrupted",
      subject: "Choose the launch date",
      summary: "Friday has the strongest evidence.",
      detail: "The sponsor is away Thursday.",
      decision: { target: "launch-date", decisionId: "d1", question: "Launch Friday or Saturday?", alternatives: ["Friday", "Saturday"], recommended: "Friday" },
      source: { showItemId: "decision:launch", task: "launch" },
      createdAt: "2026-10-22T08:00:00.000Z",
    },
  },
  {
    meaning: "status",
    object: {
      ...base,
      id: "task:site",
      kind: "activity",
      lifecycle: "active",
      subject: "Building the launch page",
      summary: "Firstmate is implementing it now.",
      activity: { phase: "working" },
      project: "Flyd",
      createdAt: "2026-10-22T08:00:00.000Z",
    },
  },
  {
    meaning: "comparison",
    object: {
      ...base,
      id: "message:compare",
      kind: "conversation",
      lifecycle: "active",
      subject: "Shippo or Unified.to",
      summary: "Both ship today; the price differs.",
      detail: "Both ship today; the price differs.",
      createdAt: "2026-10-22T08:00:00.000Z",
    },
    plan: {
      form: "comparison",
      lead: "Both ship today; the price differs.",
      criteria: ["Price", "Setup"],
      alternatives: [
        { name: "Shippo", values: ["$0.05/label", "An afternoon"] },
        { name: "Unified.to", values: ["$0.09/label", "A day"] },
      ],
      next: "Shippo is the cheaper one at your volume.",
    },
  },
  {
    meaning: "result",
    object: {
      ...base,
      id: "task:audit",
      kind: "investigation",
      lifecycle: "resolved",
      subject: "Audit the checkout copy",
      summary: "Three claims are unsupported.",
      detail: "Three claims are unsupported; the rest reads clean.",
      investigation: {
        question: "Does the checkout copy overclaim?",
        findings: [
          { heading: "Delivery time", summary: "The page promises next day, the carrier does not.", confidence: "high", evidenceIds: ["e1"] },
          { heading: "Returns", summary: "The window is 14 days, the page says 30.", confidence: "medium", evidenceIds: ["e2"] },
        ],
        uncertainties: [],
        conflicts: [],
        sourceCount: 2,
      },
      createdAt: "2026-10-22T08:00:00.000Z",
    },
  },
  {
    meaning: "artefact",
    object: {
      ...base,
      id: "artifact:deck",
      kind: "artifact",
      lifecycle: "resolved",
      subject: "Sponsor deck",
      summary: "The final deck is ready.",
      detail: "The final deck is ready.",
      artifact: { type: "document", phase: "ready" },
      evidence: [{ kind: "web", ref: "https://example.com/deck", label: "Open the deck" }],
      createdAt: "2026-10-22T08:00:00.000Z",
    },
  },
  {
    meaning: "briefing",
    object: {
      ...base,
      id: "message:briefing",
      kind: "conversation",
      lifecycle: "active",
      subject: "Your morning brief",
      summary: "Two meetings, one deadline, rain at four.",
      detail: "Two meetings, one deadline, rain at four.",
      createdAt: "2026-10-22T08:00:00.000Z",
    },
    named: "briefing",
  },
  {
    meaning: "ask",
    object: {
      ...base,
      id: "task:vendor",
      kind: "decision",
      lifecycle: "interrupted",
      subject: "The vendor deck is deferred",
      summary: "I need the existing vendor deck link.",
      detail: "I need the existing vendor deck link before that work begins.",
      decision: { target: "gnm-vendor-deck", decisionId: "d2", question: "Where is the existing vendor deck?", alternatives: [] },
      source: { showItemId: "decision:vendor", task: "gnm-vendor-deck" },
      createdAt: "2026-10-22T08:00:00.000Z",
    },
  },
];
