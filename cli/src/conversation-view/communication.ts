import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { evaluatePredicates, JEV_PINNED_MODEL } from "../cognition/system-one/jev.js";
import { predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import { loadJudgmentTraces, loadReplayCases, replayPredicates } from "../cognition/system-one/replay.js";
import { escapeHtml } from "./markdown.js";
import { SEMANTIC_KINDS, type SemanticKind, type SemanticObject } from "./semantic.js";
import type { AgentTool } from "../lib/llm.js";

export type CommunicationGoal = "explain_cause" | "contrast_expected_actual" | "show_evidence" | "identify_fix" | "compare_options" | "recommend" | "summarize_result" | "prose";
export type ClaimRole = "expected" | "actual" | "cause" | "fix" | "finding" | "recommendation" | "uncertainty";
export interface CommunicationClaim { id: string; role: ClaimRole; text: string; evidenceIds: string[] }
export interface CommunicationEvidence { id: string; label: string; quote?: string; url?: string }
export interface CommunicationContent {
  object: SemanticObject;
  claims: CommunicationClaim[];
  sources: CommunicationEvidence[];
  comparison?: { criteria: string[]; alternatives: Array<{ id: string; name: string; values: string[] }> };
}
export interface CommunicationIntent {
  primary: "explain_cause" | "compare_options" | "summarize_result" | "prose";
  goals: CommunicationGoal[];
  source: "jev" | "structure";
  confidence: number;
}
export type CommunicationBlock =
  | { id: string; kind: "contrast"; expected: string[]; actual: string[] }
  | { id: string; kind: "claim"; label: string; claimIds: string[] }
  | { id: string; kind: "comparison" }
  | { id: string; kind: "evidence"; evidenceIds: string[] };
export interface CommunicationPlan {
  form: "communication";
  lead: string;
  content: CommunicationContent;
  intent: CommunicationIntent;
  blocks: CommunicationBlock[];
  revision: string;
}

const roles = new Set<ClaimRole>(["expected", "actual", "cause", "fix", "finding", "recommendation", "uncertainty"]);
const idOK = (value: unknown): value is string => typeof value === "string" && /^[\w:.-]{1,100}$/.test(value);
const line = (value: unknown, max = 2400): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Facts and relations only. The model cannot supply a layout, HTML or executable action. */
export const DESCRIBE_ANSWER_TOOL: AgentTool = {
  name: "describe_answer",
  description: "Provide grounded answer facts and relationships when a visual explanation or comparison helps. The surface chooses the interface. Supply title, lead, semantic_kind, claims [{id,role:expected|actual|cause|fix|finding|recommendation|uncertainty,text,evidenceIds:[]}], evidence [{id,label,quote or url}], and optionally comparison {criteria:[],alternatives:[{id,name,values:[]}]}. Preserve uncertainty and every material finding or choice. Evidence quotes/URLs must occur in this turn's retrieved evidence. No layout, HTML, code, invented sources or execution instructions. Then finish with a short natural takeaway.",
  input_schema: { type: "object", properties: {
    title: { type: "string" }, lead: { type: "string" }, semantic_kind: { type: "string", enum: [...SEMANTIC_KINDS] },
    claims: { type: "array", items: { type: "object" } }, evidence: { type: "array", items: { type: "object" } }, comparison: { type: "object" },
  }, required: ["title", "lead", "semantic_kind", "claims", "evidence"] },
};

/** Validate references against the actual turn's evidence, never against the model's own output. */
export function communicationContent(value: unknown, objectId: string, corpus: string): CommunicationContent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, any>;
  const subject = line(raw.title, 240), summary = line(raw.lead, 600);
  if (!subject || !summary || !SEMANTIC_KINDS.includes(raw.semantic_kind) || !Array.isArray(raw.claims) || !raw.claims.length || raw.claims.length > 30
    || !Array.isArray(raw.evidence) || raw.evidence.length > 12) return null;
  const sources: CommunicationEvidence[] = [];
  const sourceIDs = new Set<string>();
  for (const item of raw.evidence) {
    if (!item || !idOK(item.id) || sourceIDs.has(item.id) || !line(item.label)) return null;
    const quote = line(item.quote, 1200), url = line(item.url, 2000);
    if ((!quote && !url) || (quote && (quote.length < 12 || !flat(corpus).includes(flat(quote))))) return null;
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) return null;
      } catch { return null; }
      if (!corpus.includes(url)) return null;
    }
    sourceIDs.add(item.id);
    sources.push({ id: item.id, label: line(item.label, 200), ...(quote ? { quote } : {}), ...(url ? { url } : {}) });
  }
  const claims: CommunicationClaim[] = [];
  const claimIDs = new Set<string>();
  for (const item of raw.claims) {
    if (!item || !idOK(item.id) || claimIDs.has(item.id) || !roles.has(item.role) || !line(item.text)
      || !Array.isArray(item.evidenceIds) || !item.evidenceIds.every((id: unknown) => typeof id === "string" && sourceIDs.has(id))) return null;
    claimIDs.add(item.id);
    claims.push({ id: item.id, role: item.role, text: line(item.text), evidenceIds: [...new Set<string>(item.evidenceIds)] });
  }
  let comparison: CommunicationContent["comparison"];
  if (raw.comparison) {
    const input = raw.comparison;
    if (!Array.isArray(input.criteria) || input.criteria.length < 2 || input.criteria.length > 6 || !input.criteria.every((x: unknown) => line(x))
      || !Array.isArray(input.alternatives) || input.alternatives.length < 2 || input.alternatives.length > 6) return null;
    const names = new Set<string>();
    for (const item of input.alternatives) {
      if (!item || !idOK(item.id) || names.has(item.id) || !line(item.name) || !Array.isArray(item.values)
        || item.values.length !== input.criteria.length || !item.values.every((x: unknown) => line(x))) return null;
      names.add(item.id);
    }
    comparison = { criteria: input.criteria.map((x: unknown) => line(x, 100)), alternatives: input.alternatives.map((x: any) => ({ id: x.id, name: line(x.name, 100), values: x.values.map((v: unknown) => line(v, 300)) })) };
  }
  return {
    object: { id: objectId, kind: raw.semantic_kind as SemanticKind, lifecycle: "resolved", subject, summary,
      evidence: sources.map((source) => ({ kind: source.url ? "web" : "text", ref: source.url ?? source.id, label: source.label })),
      actions: sources.filter((source) => source.url).map((source) => ({ id: `inspect:${source.id}`, kind: "inspect", label: source.label, value: source.url })),
      source: { showItemId: objectId } },
    claims, sources, ...(comparison ? { comparison } : {}),
  };
}

export function communicationProjection(content: CommunicationContent, question: string): Record<string, unknown> {
  return { question: question.slice(0, 600), semantic_kind: content.object.kind,
    claims: content.claims.map((claim) => ({ role: claim.role, text: claim.text.slice(0, 240), evidence_count: claim.evidenceIds.length })),
    comparison: content.comparison ? { criteria: content.comparison.criteria, alternatives: content.comparison.alternatives.map((item) => item.name) } : null,
    evidence_count: content.sources.length, action_kinds: content.object.actions.map((action) => action.kind) };
}

/** This is a fallback on explicit relations, not a semantic-kind-to-layout map. */
export function structuralCommunicationGoal(content: CommunicationContent): CommunicationIntent["primary"] {
  if (content.comparison) return "compare_options";
  if (content.claims.some((claim) => claim.role === "cause")) return "explain_cause";
  return content.claims.length > 1 ? "summarize_result" : "prose";
}

let calibration: Promise<boolean> | undefined;
/** Never fabricate or relabel recordings to activate a new predicate. */
export function communicationJevCalibrated(): Promise<boolean> {
  return calibration ??= (async () => {
    try {
      const cases = loadReplayCases(fileURLToPath(new URL("../evals/fixtures/system-one/communication.jsonl", import.meta.url)));
      const recordings = loadJudgmentTraces(fileURLToPath(new URL("../evals/fixtures/system-one/recordings.jsonl", import.meta.url)));
      const report = await replayPredicates(cases, { mode: "recorded", recordings });
      const result = report.predicates.find((item) => item.predicateId === "communication_goal");
      return Boolean(result && result.cases >= 12 && result.jev.accuracy >= 0.9 && result.jev.abstainRate <= 0.1
        && result.models.length === 1 && result.models[0] === (process.env.FLYD_JEV_MODEL ?? JEV_PINNED_MODEL)
        && !result.unreplayable.missing.length && !result.unreplayable.stale.length && !result.unreplayable.errors.length);
    } catch { return false; }
  })();
}

export async function communicationIntent(content: CommunicationContent, question: string, options: {
  evaluate?: typeof evaluatePredicates; calibrated?: () => Promise<boolean>;
} = {}): Promise<CommunicationIntent> {
  let primary = structuralCommunicationGoal(content);
  let source: CommunicationIntent["source"] = "structure", confidence = 1;
  if (await (options.calibrated ?? communicationJevCalibrated)()) {
    const evaluation = await (options.evaluate ?? evaluatePredicates)(communicationProjection(content, question), [questionFor("communication_goal")],
      { model: process.env.FLYD_JEV_MODEL ?? JEV_PINNED_MODEL }, { purpose: "presentation", allowedFields: ["question", "semantic_kind", "claims", "comparison", "evidence_count", "action_kinds"] }).catch(() => null);
    const answer = evaluation?.ok ? evaluation.answers.communication_goal : undefined;
    const chosen = answer?.choice;
    if (answer && answer.confidence >= predicateThreshold("communication_goal") && answer.probability >= predicateThreshold("communication_goal")
      && ["explain_cause", "compare_options", "summarize_result", "prose"].includes(chosen ?? "")
      && (chosen !== "compare_options" || content.comparison) && (chosen !== "explain_cause" || content.claims.some((claim) => claim.role === "cause"))) {
      primary = chosen as CommunicationIntent["primary"]; source = "jev"; confidence = answer.confidence;
    }
  }
  const has = (role: ClaimRole) => content.claims.some((claim) => claim.role === role);
  const goals: CommunicationGoal[] = [primary];
  if (primary === "explain_cause" && has("expected") && has("actual")) goals.push("contrast_expected_actual");
  if (has("fix")) goals.push("identify_fix");
  if (has("recommendation")) goals.push("recommend");
  if (content.sources.length) goals.push("show_evidence");
  return { primary, goals, source, confidence };
}

export function manifestationPlan(content: CommunicationContent, intent: CommunicationIntent): CommunicationPlan {
  const ids = (role: ClaimRole) => content.claims.filter((claim) => claim.role === role).map((claim) => claim.id);
  const blocks: CommunicationBlock[] = [];
  if (intent.primary === "explain_cause") {
    blocks.push({ id: "cause", kind: "claim", label: "Cause", claimIds: ids("cause") });
    if (intent.goals.includes("contrast_expected_actual")) blocks.push({ id: "contrast", kind: "contrast", expected: ids("expected"), actual: ids("actual") });
  } else if (intent.primary === "compare_options") blocks.push({ id: "comparison", kind: "comparison" });
  const covered = new Set(blocks.flatMap((block) => block.kind === "claim" ? block.claimIds : block.kind === "contrast" ? [...block.expected, ...block.actual] : []));
  const additional = content.claims.filter((claim) => !covered.has(claim.id) && !["fix", "recommendation", "uncertainty"].includes(claim.role));
  if (additional.length) blocks.push({ id: "findings", kind: "claim", label: "Findings", claimIds: additional.map((claim) => claim.id) });
  if (ids("uncertainty").length) blocks.push({ id: "uncertainty", kind: "claim", label: "Still uncertain", claimIds: ids("uncertainty") });
  if (intent.goals.includes("recommend")) blocks.push({ id: "recommendation", kind: "claim", label: "Recommendation", claimIds: ids("recommendation") });
  if (intent.goals.includes("identify_fix")) blocks.push({ id: "fix", kind: "claim", label: "Next", claimIds: ids("fix") });
  if (intent.goals.includes("show_evidence")) blocks.push({ id: "evidence", kind: "evidence", evidenceIds: content.sources.map((source) => source.id) });
  return { form: "communication", lead: content.object.summary, content, intent, blocks,
    revision: createHash("sha256").update(JSON.stringify([content, intent.primary, intent.goals])).digest("hex").slice(0, 16) };
}

export function plainCommunication(plan: CommunicationPlan): string {
  return [plan.lead, ...plan.content.claims.map((claim) => claim.text), ...(plan.content.comparison ? [
    plan.content.comparison.criteria.join(" · "), ...plan.content.comparison.alternatives.map((item) => `${item.name}: ${item.values.join(" · ")}`),
  ] : []), ...plan.content.sources.map((source) => [source.label, source.quote, source.url].filter(Boolean).join(" — "))].join("\n\n");
}

/** A malformed stored plan still leaves readable facts, never executable markup or lost choices. */
export function communicationFallback(value: unknown): string {
  const raw = value as Partial<CommunicationPlan> | null;
  const content = raw?.content;
  const claims = Array.isArray(content?.claims) ? content.claims.slice(0, 30).map((claim) => line(claim?.text)) : [];
  const comparison = content?.comparison;
  const criteria = Array.isArray(comparison?.criteria) ? comparison.criteria.slice(0, 6).map((item) => line(item, 100)).join(" · ") : "";
  const options = Array.isArray(comparison?.alternatives) ? comparison.alternatives.slice(0, 6).map((option) => [line(option?.name, 100),
    ...(Array.isArray(option?.values) ? option.values.slice(0, 6).map((item) => line(item, 300)) : [])].filter(Boolean).join(" · ")) : [];
  const sources = Array.isArray(content?.sources) ? content.sources.slice(0, 12).map((source) => [line(source?.label, 200), line(source?.quote, 1200), line(source?.url, 2000)].filter(Boolean).join(" — ")) : [];
  return [line(raw?.lead, 600), ...claims, criteria, ...options, ...sources].filter(Boolean).join("\n\n");
}

/** One production boundary: structured facts are produced before intent and rendering. */
export async function answerWithCommunication(question: string, produce: (onContent: (content: CommunicationContent) => void) => Promise<string | { deferred: true }>,
  options: Parameters<typeof communicationIntent>[2] = {}): Promise<string | { deferred: true } | CommunicationPlan> {
  let content: CommunicationContent | undefined;
  const result = await produce((value) => { content = value; });
  if (typeof result !== "string" || !content) return result;
  const plan = manifestationPlan(content, await communicationIntent(content, question, options));
  return plan.intent.primary === "prose" ? plainCommunication(plan) : plan;
}

/** HTML is Core-owned. All displayed data is escaped; links only inspect validated evidence. */
export function communicationHtml(plan: CommunicationPlan): string {
  const claim = (id: string) => plan.content.claims.find((item) => item.id === id)!;
  const text = (ids: string[]) => ids.map((id) => {
    const item = claim(id);
    return `<p data-comm-key="claim:${escapeHtml(id)}">${escapeHtml(item.text)}${item.evidenceIds.map((sourceId) => {
      const index = plan.content.sources.findIndex((source) => source.id === sourceId);
      return ` <button type="button" class="comm-source" data-comm-key="ref:${escapeHtml(sourceId)}" data-comm-source="${escapeHtml(sourceId)}" aria-label="Evidence: ${escapeHtml(plan.content.sources[index]!.label)}">[${index + 1}]</button>`;
    }).join("")}</p>`;
  }).join("");
  const block = (item: CommunicationBlock): string => {
    let html = "";
    if (item.kind === "claim") html = `<h4>${escapeHtml(item.label)}</h4>${text(item.claimIds)}`;
    else if (item.kind === "contrast") html = `<div><h4>Expected</h4>${text(item.expected)}</div><div><h4>Actual</h4>${text(item.actual)}</div>`;
    else if (item.kind === "comparison" && plan.content.comparison) {
      const comparison = plan.content.comparison;
      html = `<table><thead><tr><th></th>${comparison.alternatives.map((option) => `<th scope="col">${escapeHtml(option.name)}</th>`).join("")}</tr></thead><tbody>`
        + comparison.criteria.map((criterion, index) => `<tr data-comm-key="criterion:${index}"><th scope="row">${escapeHtml(criterion)}</th>${comparison.alternatives.map((option) => `<td>${escapeHtml(option.values[index]!)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
    } else if (item.kind === "evidence") html = `<h4>Evidence</h4>${item.evidenceIds.map((id) => {
      const evidence = plan.content.sources.find((source) => source.id === id)!;
      return `<details data-comm-key="evidence:${escapeHtml(id)}" data-comm-source-id="${escapeHtml(id)}"><summary>${escapeHtml(evidence.label)}</summary>${evidence.quote ? `<blockquote>${escapeHtml(evidence.quote)}</blockquote>` : ""}${evidence.url ? `<a data-action-id="inspect:${escapeHtml(id)}" href="${escapeHtml(evidence.url)}" target="_blank" rel="noreferrer noopener">Open source</a>` : ""}</details>`;
    }).join("")}`;
    return `<section class="comm-${item.id}" data-comm-key="block:${item.id}">${html}</section>`;
  };
  return `<section class="answer-form communication" data-form="communication" data-comm-object="${escapeHtml(plan.content.object.id)}" data-semantic-kind="${plan.content.object.kind}" data-communication="${plan.intent.primary}" data-revision="${plan.revision}"><p class="answer-lead" data-comm-key="lead">${escapeHtml(plan.lead)}</p>${plan.blocks.map(block).join("")}</section>`;
}

/** Stored/wire plans are data too: regenerate blocks from validated content instead of trusting supplied HTML/layout. */
export function validateCommunicationPlan(value: unknown): CommunicationPlan | null {
  const raw = value as CommunicationPlan;
  if (!raw || raw.form !== "communication" || !raw.content?.object || !raw.intent
    || typeof raw.content.object.id !== "string" || !/^[\w:.-]{1,300}$/.test(raw.content.object.id)
    || !Array.isArray(raw.content.sources) || raw.content.sources.some((source) => !source || typeof source !== "object")) return null;
  const content = raw.content;
  const corpus = content.sources?.map((source) => [source.quote, source.url].filter(Boolean).join("\n")).join("\n") ?? "";
  const valid = communicationContent({ title: content.object.subject, lead: content.object.summary, semantic_kind: content.object.kind,
    claims: content.claims, evidence: content.sources, comparison: content.comparison }, content.object.id, corpus);
  if (!valid || !["explain_cause", "compare_options", "summarize_result", "prose"].includes(raw.intent.primary)) return null;
  if (raw.intent.primary === "compare_options" && !valid.comparison) return null;
  if (raw.intent.primary === "explain_cause" && !valid.claims.some((claim) => claim.role === "cause")) return null;
  const has = (role: ClaimRole) => valid.claims.some((claim) => claim.role === role);
  const goals: CommunicationGoal[] = [raw.intent.primary];
  if (raw.intent.primary === "explain_cause" && has("expected") && has("actual")) goals.push("contrast_expected_actual");
  if (has("fix")) goals.push("identify_fix"); if (has("recommendation")) goals.push("recommend"); if (valid.sources.length) goals.push("show_evidence");
  return manifestationPlan(valid, { primary: raw.intent.primary, goals, source: raw.intent.source === "jev" ? "jev" : "structure", confidence: Math.max(0, Math.min(1, Number(raw.intent.confidence) || 0)) });
}
