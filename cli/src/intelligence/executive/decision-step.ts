import { relayShortfalls } from "../../runtime/honesty-check.js";
import { createHash } from "node:crypto";
import { validateEnvelope, type ContextEnvelope } from "../context-envelope.js";
import type { IntelligenceEventStore, StoredEvent } from "../event-store.js";

export const EXECUTIVE_DECISION_VERSION = "flyd.executive-decision.v1";
export const EXECUTIVE_DISPOSITIONS = ["handle_internally", "ask_george", "backstage"] as const;
export type ExecutiveDisposition = (typeof EXECUTIVE_DISPOSITIONS)[number];

export type ExecutiveProposal =
  | {
    kind: "question";
    summary: string;
    question: string;
    questionEvidence: string;
    options: string[];
    recommendation?: { option: string; rationale: string; evidence: string };
    evidenceRefs: string[];
  }
  | {
    kind: "internal_action";
    summary: string;
    action: { kind: "request_status"; target: string; evidence: string };
    evidenceRefs: string[];
  }
  | { kind: "verified_result"; summary: string; evidenceRefs: string[] }
  | { kind: "routine" | "unclear"; summary: string; evidenceRefs: string[] };

export interface ExecutiveJudgment {
  route: "ask_george" | "handle_internally" | "backstage" | "unclear";
  confidence: number;
  notable: boolean;
}

export interface ExecutiveAuthorityGrant {
  grantId: string;
  capability: string;
  target: string;
}

export interface ExecutiveDecisionInput {
  sourceId: string;
  sourceEventId: string;
  taskId?: string;
  sourceText: string;
  proposal: ExecutiveProposal;
  judgment?: ExecutiveJudgment;
  authority?: ExecutiveAuthorityGrant[];
  verification?: { status: "verified" | "failed" | "unknown"; evidenceRefs: string[] };
}

export interface ExecutiveVerification {
  status: "pending" | "verified" | "failed" | "unknown";
  evidenceRefs: string[];
}
export interface ExecutiveRecommendation {
  option?: string;
  rationale: string;
}
interface ExecutiveDecisionBase {
  schema: typeof EXECUTIVE_DECISION_VERSION;
  decisionId: string;
  sourceId: string;
  sourceEventId: string;
  taskId?: string;
  reason: string;
  summary: string;
  evidenceRefs: string[];
  createdAt: string;
}
export interface ExecutiveInternalAction {
  capability: "firstmate.message";
  target: string;
  text: string;
  grantId: string;
  idempotencyKey: string;
}
export type ExecutiveDecisionRecord = ExecutiveDecisionBase & (
  | { disposition: "backstage"; show: false; notify: false; verification: ExecutiveVerification;
      question?: never; options?: never; recommendation?: never; action?: never; resolution?: never }
  | { disposition: "ask_george"; show: boolean; notify: boolean; question: string; options: string[];
      recommendation: ExecutiveRecommendation; verification: ExecutiveVerification; action?: never;
      resolution?: { answer: string; decidedAt: string; evidenceRefs: string[] } }
  | { disposition: "handle_internally"; question?: never; options?: never; recommendation?: never; resolution?: never } & (
      | { action: ExecutiveInternalAction; show: false; notify: false; verification: ExecutiveVerification }
      | { action?: never; show: true; notify: boolean; verification: { status: "verified"; evidenceRefs: string[] } }
    )
);

export function recommendationText(recommendation: ExecutiveRecommendation): string {
  return recommendation.option ? `I recommend "${recommendation.option}". ${recommendation.rationale}` : recommendation.rationale;
}

const MIN_CONFIDENCE = 0.8;
const INTERNAL_STATUS_NOTE = "Check the original request and current result. Continue only within its accepted scope, then report verified evidence or a genuine George-owned decision with your recommendation.";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function containsEvidence(source: string, quote: string): boolean {
  const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return Boolean(normalized(quote)) && normalized(source).includes(normalized(quote));
}

function groundedRefs(input: ExecutiveDecisionInput): string[] {
  return [...new Set(input.proposal.evidenceRefs.filter((ref) => ref.trim()))];
}

function decide(input: ExecutiveDecisionInput, now = new Date()): ExecutiveDecisionRecord {
  const { proposal, judgment } = input;
  const evidenceRefs = groundedRefs(input);
  const decisionId = digest(`${input.sourceId}\0${input.sourceEventId}`).slice(0, 32);
  const verification = input.verification ?? { status: "unknown" as const, evidenceRefs: [] };
  const confidence = judgment?.confidence ?? 0;
  const decision: ExecutiveDecisionRecord = {
    schema: EXECUTIVE_DECISION_VERSION,
    decisionId,
    sourceId: input.sourceId,
    sourceEventId: input.sourceEventId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    disposition: "backstage",
    reason: "insufficient evidence for a George-owned decision or verified result",
    summary: proposal.summary.trim(),
    evidenceRefs,
    verification,
    show: false,
    notify: false,
    createdAt: now.toISOString(),
  };

  if (proposal.kind === "question") {
    const options = [...new Set(proposal.options.map((option) => option.trim()).filter(Boolean))];
    const grounded = containsEvidence(input.sourceText, proposal.questionEvidence);
    const alternativesGrounded = options.length >= 2 && options.length <= 6
      && options.every((option) => containsEvidence(proposal.questionEvidence, option));
    if (!grounded || judgment?.route === "backstage" && confidence >= MIN_CONFIDENCE) {
      return { ...decision, reason: grounded ? "Jev judged the item backstage" : "question or alternatives were not grounded in source evidence" };
    }
    const recommendation = proposal.recommendation && options.includes(proposal.recommendation.option)
      && containsEvidence(input.sourceText, proposal.recommendation.evidence)
      ? { option: proposal.recommendation.option, rationale: proposal.recommendation.rationale.trim() }
      : { rationale: "I recommend holding this choice open; the evidence does not support a preference yet." };
    return {
      ...decision,
      disposition: "ask_george",
      reason: "a source-grounded choice remains George's",
      question: alternativesGrounded && proposal.question.trim() ? proposal.question.trim() : proposal.questionEvidence.trim(),
      options: alternativesGrounded ? options : [],
      recommendation: alternativesGrounded ? recommendation : { rationale: "I recommend clarifying the alternatives before acting." },
      verification: { status: "unknown", evidenceRefs: [] },
      show: true,
      notify: true,
    };
  }

  if (proposal.kind === "verified_result" && verification.status === "verified" && verification.evidenceRefs.length) {
    const notable = judgment?.notable === true;
    return {
      ...decision,
      disposition: "handle_internally",
      reason: "the outcome has independent verification evidence",
      evidenceRefs: [...new Set([...evidenceRefs, ...verification.evidenceRefs])],
      verification: { status: "verified", evidenceRefs: verification.evidenceRefs },
      show: true,
      notify: notable,
    };
  }

  if (proposal.kind === "internal_action") {
    const grant = proposal.action.kind === "request_status" && input.authority?.find((candidate) => candidate.capability === "firstmate.message"
      && candidate.target === proposal.action.target);
    if (!grant || judgment?.route !== "handle_internally" || confidence < MIN_CONFIDENCE
      || !containsEvidence(input.sourceText, proposal.action.evidence)) {
      return { ...decision, reason: "no matching deterministic authority grant and grounded high-confidence interpretation" };
    }
    return {
      ...decision,
      disposition: "handle_internally",
      reason: "authorized reversible internal action; verification is pending",
      action: {
        capability: "firstmate.message",
        grantId: grant.grantId,
        target: proposal.action.target,
        text: `Task ${proposal.action.target}. ${INTERNAL_STATUS_NOTE}`,
        idempotencyKey: `executive:${decisionId}:${grant.grantId}`,
      },
      verification: { status: "pending", evidenceRefs: [] },
    };
  }

  return { ...decision, reason: proposal.kind === "routine" ? "routine operational state stays backstage" : "interpretation is unclear" };
}

/** Output checks remain the final fence after interpretation, policy and verification. */
export function decideExecutiveStep(input: ExecutiveDecisionInput, now = new Date()): ExecutiveDecisionRecord {
  const decision = decide(input, now);
  if (!decision.show) return decision;
  const displayed = [decision.question ?? decision.summary, ...(decision.options ?? []), decision.recommendation?.rationale ?? ""].join("\n");
  if (relayShortfalls(displayed).length || /\b(?:I|we|Flyd)(?:['’]ll|\s+will|\s+(?:am|are|is)\s+going\s+to)\b/i.test(displayed)) return { schema: decision.schema, decisionId: decision.decisionId, sourceId: decision.sourceId, sourceEventId: decision.sourceEventId, ...(decision.taskId ? { taskId: decision.taskId } : {}), createdAt: decision.createdAt, summary: decision.summary, evidenceRefs: decision.evidenceRefs, verification: { status: "unknown", evidenceRefs: [] }, disposition: "backstage", show: false, notify: false, reason: "the final output check held this wording" };
  return decision;
}

export function persistExecutiveDecision(store: IntelligenceEventStore, decision: ExecutiveDecisionRecord, revision = ""): StoredEvent | null {
  const envelope: ContextEnvelope = {
    pathKind: "executive",
    kind: "executive_decision",
    sourceId: "executive.cycle",
    consent: { grantedAt: decision.createdAt, scopes: ["executive"] },
    retentionClass: "local_default",
    payloadClassification: "operational",
    provenance: `executive:${decision.schema}`,
    idempotencyKey: `step:${decision.decisionId}${revision ? `:${revision}` : ""}`,
    correlationId: decision.sourceEventId,
    evidenceRefs: decision.evidenceRefs,
    policyVersion: decision.schema,
    payload: { decision },
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error(`executive decision rejected: ${validation.detail}`);
  return store.append(envelope);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}
function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : null;
}

/** Parse the durable record at the event-store boundary; never trust a payload cast. */
export function parseExecutiveDecision(value: unknown): ExecutiveDecisionRecord | null {
  const item = object(value);
  if (!item || item.schema !== EXECUTIVE_DECISION_VERSION || typeof item.decisionId !== "string"
    || typeof item.sourceId !== "string" || typeof item.sourceEventId !== "string" || typeof item.reason !== "string"
    || typeof item.summary !== "string" || typeof item.createdAt !== "string"
    || item.taskId !== undefined && typeof item.taskId !== "string") return null;
  const refs = stringList(item.evidenceRefs);
  const check = object(item.verification);
  const checkRefs = stringList(check?.evidenceRefs);
  const status = check?.status;
  if (!refs || !checkRefs || status !== "pending" && status !== "unknown" && status !== "failed" && status !== "verified") return null;
  const verification: ExecutiveVerification = { status, evidenceRefs: checkRefs };
  const base: ExecutiveDecisionBase = {
    schema: EXECUTIVE_DECISION_VERSION, decisionId: item.decisionId, sourceId: item.sourceId, sourceEventId: item.sourceEventId,
    reason: item.reason, summary: item.summary, createdAt: item.createdAt, evidenceRefs: refs,
    ...(typeof item.taskId === "string" ? { taskId: item.taskId } : {}),
  };
  if (item.disposition === "ask_george") {
    const options = stringList(item.options);
    const recommendation = object(item.recommendation);
    if (!options || !recommendation || typeof recommendation.rationale !== "string" || typeof item.question !== "string"
      || recommendation.option !== undefined && typeof recommendation.option !== "string"
      || item.action !== undefined || typeof item.show !== "boolean" || typeof item.notify !== "boolean") return null;
    const rec: ExecutiveRecommendation = { rationale: recommendation.rationale, ...(typeof recommendation.option === "string" ? { option: recommendation.option } : {}) };
    const resolved = object(item.resolution);
    if (item.resolution !== undefined && (!resolved || typeof resolved.answer !== "string" || typeof resolved.decidedAt !== "string" || !stringList(resolved.evidenceRefs))) return null;
    const resolution = resolved && typeof resolved.answer === "string" && typeof resolved.decidedAt === "string"
      ? { answer: resolved.answer, decidedAt: resolved.decidedAt, evidenceRefs: stringList(resolved.evidenceRefs) ?? [] } : undefined;
    if (resolution && (item.show || item.notify)) return null;
    return { ...base, disposition: "ask_george", question: item.question, options, recommendation: rec, verification,
      show: item.show, notify: item.notify, ...(resolution ? { resolution } : {}) };
  }
  if (item.question !== undefined || item.options !== undefined || item.recommendation !== undefined || item.resolution !== undefined) return null;
  if (item.disposition === "backstage" && item.show === false && item.notify === false && item.action === undefined) {
    return { ...base, disposition: "backstage", show: false, notify: false, verification };
  }
  if (item.disposition !== "handle_internally") return null;
  const action = object(item.action);
  if (action && action.capability === "firstmate.message" && typeof action.target === "string" && typeof action.text === "string"
    && typeof action.grantId === "string" && typeof action.idempotencyKey === "string" && item.show === false && item.notify === false) {
    return { ...base, disposition: "handle_internally", action: { capability: action.capability, target: action.target, text: action.text, grantId: action.grantId, idempotencyKey: action.idempotencyKey }, verification, show: false, notify: false };
  }
  if (item.action === undefined && status === "verified" && checkRefs.length && item.show === true && typeof item.notify === "boolean") {
    return { ...base, disposition: "handle_internally", verification: { status, evidenceRefs: checkRefs }, show: true, notify: item.notify };
  }
  return null;
}

export function readExecutiveDecision(store: IntelligenceEventStore, decisionId: string): ExecutiveDecisionRecord | null {
  let found: ExecutiveDecisionRecord | null = null;
  for (const event of store.readSource("executive.cycle")) {
    const candidate = parseExecutiveDecision(event.payload?.decision);
    if (candidate?.decisionId === decisionId) found = candidate;
  }
  return found;
}

export function resolveExecutiveDecision(
  store: IntelligenceEventStore,
  decisionId: string,
  answer: string,
  evidenceRefs: string[],
  now = new Date(),
): ExecutiveDecisionRecord {
  const current = readExecutiveDecision(store, decisionId);
  const value = answer.trim();
  if (current?.resolution?.answer === value) return current;
  if (!current || current.disposition !== "ask_george" || !current.show) throw new Error(`Decision ${decisionId} is no longer open`);
  if (!value) throw new Error("Decision answer is required");
  const resolved: ExecutiveDecisionRecord = {
    ...current,
    show: false,
    notify: false,
    resolution: { answer: value, decidedAt: now.toISOString(), evidenceRefs: [...new Set(evidenceRefs.filter(Boolean))] },
  };
  persistExecutiveDecision(store, resolved, "resolution");
  return resolved;
}
