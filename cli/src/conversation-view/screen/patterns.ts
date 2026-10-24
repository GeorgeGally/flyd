import type { ManifestationPlan, SemanticObject } from "../semantic.js";
import { meaningOf, type ScreenMeaning } from "./meaning.js";

/** One block a reviewed pattern can render. The page draws these, never a model. */
export type PatternBlock =
  | { kind: "question"; text: string }
  | { kind: "choices"; options: string[]; recommended?: string }
  | { kind: "recommendation"; text: string }
  | { kind: "findings"; items: Array<{ heading: string; summary: string; confidence: string }> }
  | { kind: "comparison"; criteria: string[]; alternatives: Array<{ name: string; values: string[] }> }
  | { kind: "document"; text: string; ref?: string }
  | { kind: "operation"; text: string; category: string }
  | { kind: "metrics"; items: Array<{ label: string; value: string }> }
  | { kind: "evidence"; items: Array<{ label: string; ref: string; closed?: boolean }> };

export type PatternBlockKind = PatternBlock["kind"];

/** How a person answers a pattern. "none" means the pattern only shows. */
export type PatternAction = "choose" | "answer" | "approve" | "open" | "none";

/** Where a real visual sits when the object has one: beside the text, under it, or nowhere. */
export type PatternVisual = "beside" | "below" | "none";

export interface ScreenPattern {
  id: string;
  meaning: ScreenMeaning;
  /** The blocks the pattern renders, in order. */
  body: PatternBlockKind[];
  action: PatternAction;
  visual: PatternVisual;
  /** What the pattern is for, in one line, for the reviewer. */
  about: string;
}

/**
 * The reviewed pattern catalog: one pattern per meaning, the only place a
 * meaning is turned into a screen shape. Adding a meaning means adding a
 * pattern here and a fixture beside it, never a new layout in the page.
 */
export const SCREEN_PATTERNS: Record<ScreenMeaning, ScreenPattern> = {
  answer: {
    id: "answer-prose",
    meaning: "answer",
    body: ["document"],
    action: "open",
    visual: "below",
    about: "A written answer Flyd gives in its own voice; the words are the screen.",
  },
  decision: {
    id: "decision-choice",
    meaning: "decision",
    body: ["operation", "question", "choices", "recommendation", "metrics", "evidence"],
    action: "choose",
    visual: "beside",
    about: "A choice only George can make, with its alternatives and the recommended one.",
  },
  status: {
    id: "status-progress",
    meaning: "status",
    body: ["document", "metrics"],
    action: "none",
    visual: "below",
    about: "Work under way or a watch standing; what it is doing and where it stands.",
  },
  comparison: {
    id: "comparison-table",
    meaning: "comparison",
    body: ["comparison", "recommendation", "evidence"],
    action: "none",
    visual: "none",
    about: "Options against the same criteria, with one recommendation and symmetric evidence.",
  },
  result: {
    id: "result-findings",
    meaning: "result",
    body: ["document", "findings", "metrics", "evidence"],
    action: "open",
    visual: "beside",
    about: "A finished piece of work or an investigation: what it found, and how to read it.",
  },
  artefact: {
    id: "artefact-document",
    meaning: "artefact",
    body: ["document", "evidence"],
    action: "open",
    visual: "beside",
    about: "A durable artefact: the real result, opened where it lives.",
  },
  briefing: {
    id: "briefing-digest",
    meaning: "briefing",
    body: ["document", "metrics"],
    action: "none",
    visual: "below",
    about: "A personal briefing: what is coming and what it means, in one read.",
  },
  ask: {
    id: "ask-question",
    meaning: "ask",
    body: ["question", "recommendation", "metrics"],
    action: "answer",
    visual: "beside",
    about: "A question with no alternatives yet; George answers in his own words.",
  },
};

export interface FilledScreen {
  meaning: ScreenMeaning;
  pattern: string;
  title: string;
  lead: string;
  blocks: PatternBlock[];
  action: PatternAction;
  visual: PatternVisual;
}

function questionBlock(object: SemanticObject): PatternBlock | undefined {
  const question = object.decision?.question;
  if (!question) return undefined;
  return { kind: "question", text: question };
}

function choiceBlock(object: SemanticObject): PatternBlock | undefined {
  const options = object.decision?.alternatives ?? [];
  if (options.length < 2) return undefined;
  return {
    kind: "choices",
    options,
    ...(object.decision?.recommended ? { recommended: object.decision.recommended } : {}),
  };
}

function recommendationBlock(object: SemanticObject, plan?: ManifestationPlan): PatternBlock | undefined {
  if (object.decision?.recommended) return { kind: "recommendation", text: `I'd pick ${object.decision.recommended}.` };
  if (plan?.form === "comparison" && plan.next) return { kind: "recommendation", text: plan.next };
  if (plan?.form === "diagnosis" && plan.next) return { kind: "recommendation", text: plan.next };
  return undefined;
}

function findingsBlock(object: SemanticObject): PatternBlock | undefined {
  const findings = object.investigation?.findings ?? [];
  if (!findings.length) return undefined;
  return {
    kind: "findings",
    items: findings.map((finding) => ({ heading: finding.heading, summary: finding.summary, confidence: finding.confidence })),
  };
}

function comparisonBlock(plan?: ManifestationPlan): PatternBlock | undefined {
  if (plan?.form !== "comparison") return undefined;
  return { kind: "comparison", criteria: plan.criteria, alternatives: plan.alternatives };
}

function documentBlock(object: SemanticObject): PatternBlock | undefined {
  const text = object.detail || object.summary;
  if (!text) return undefined;
  const ref = (object.evidence ?? []).find((work) => work.kind === "web" && !work.closed)?.ref;
  return { kind: "document", text, ...(ref ? { ref } : {}) };
}

function operationBlock(object: SemanticObject): PatternBlock | undefined {
  if (!object.action) return undefined;
  return { kind: "operation", text: object.action.operation, category: object.action.category };
}

function metricsBlock(object: SemanticObject): PatternBlock | undefined {
  const items: Array<{ label: string; value: string }> = [];
  if (object.project) items.push({ label: "Project", value: object.project });
  if (object.status) items.push({ label: "State", value: object.status });
  const source = object.investigation?.sourceCount;
  if (source !== undefined) items.push({ label: "Sources", value: String(source) });
  if (!items.length) return undefined;
  return { kind: "metrics", items };
}

function evidenceBlock(object: SemanticObject): PatternBlock | undefined {
  const items = (object.evidence ?? [])
    .filter((work) => work.kind === "web")
    .map((work) => ({ label: work.label || "Open", ref: work.ref, ...(work.closed ? { closed: true } : {}) }));
  if (!items.length) return undefined;
  return { kind: "evidence", items };
}

function blockFor(kind: PatternBlockKind, object: SemanticObject, plan?: ManifestationPlan): PatternBlock | undefined {
  switch (kind) {
    case "question": return questionBlock(object);
    case "choices": return choiceBlock(object);
    case "recommendation": return recommendationBlock(object, plan);
    case "findings": return findingsBlock(object);
    case "comparison": return comparisonBlock(plan);
    case "document": return documentBlock(object);
    case "operation": return operationBlock(object);
    case "metrics": return metricsBlock(object);
    case "evidence": return evidenceBlock(object);
  }
}

/** Whether two lines say the same words, whatever their case, punctuation or spacing. Pure. */
export function sameWords(a: string, b: string): boolean {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return words(a) !== "" && words(a) === words(b);
}

/** The approved action for an approval-shaped decision, so the pattern can be answered in one tap. */
function approvalAction(object: SemanticObject): PatternAction {
  return object.action?.requiresApproval ? "approve" : "choose";
}

/**
 * Fill the reviewed pattern for an object with the object's own meaning. Pure:
 * the same object and plan always give the same screen.
 */
export function fillScreen(object: SemanticObject, plan?: ManifestationPlan, named?: ScreenMeaning): FilledScreen {
  const meaning = meaningOf(object, plan, named);
  const pattern = SCREEN_PATTERNS[meaning];
  const blocks = pattern.body.flatMap((kind) => {
    const block = blockFor(kind, object, plan);
    return block ? [block] : [];
  });
  // The lead never repeats the headline: a lead that only says the title again is no lead.
  const lead = object.summary || object.detail || "";
  return {
    meaning,
    pattern: pattern.id,
    title: object.subject,
    lead: sameWords(lead, object.subject) ? "" : lead,
    blocks,
    action: pattern.action === "choose" ? approvalAction(object) : pattern.action,
    visual: pattern.visual,
  };
}

/** What a screen needs before it may ship: a body and, when the pattern asks, an action. */
export function screenComplete(filled: FilledScreen): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!filled.blocks.length) missing.push("body");
  if (filled.action !== "none" && filled.action !== "open" && !filled.blocks.some((block) => block.kind === "choices" || block.kind === "question")) {
    missing.push("action");
  }
  return { ok: missing.length === 0, missing };
}
