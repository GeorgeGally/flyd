import { relayShortfalls } from "../../runtime/honesty-check.js";
import { BACKSTAGE_ROLES } from "../../lib/backstage.js";
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
  /** Flyd's notes already delivered to this task's boss; each is sent at most once per run. */
  sentToBoss?: string[];
  sourceFailed?: boolean;
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

/** What Flyd tells a domain boss that asked George for an implementation call. */
export const HANDLE_IT_YOURSELF = [
  "This is an implementation call, not one for George, so Flyd has not put it to him.",
  "Make it yourself in line with what he asked for, using the authority the run already has, and reply with the outcome.",
  "Only if it truly turns on what he wants, his money, his name, people he deals with, or something irreversible, reply needs_decision again saying why it is his, with your recommendation, and Flyd will bring it to him.",
].join(" ");

/** What Flyd tells a domain boss whose work stopped or whose state is unclear. */
export const RECOVER_IT_YOURSELF = [
  "This work stopped or its state is unclear, and that is not a decision for George, so Flyd has not put it to him.",
  "Find out where it stands, recover it within what he asked for using the authority the run already has, and reply with the verified outcome.",
  "Only if recovery truly turns on what he wants, his money, his name, people he deals with, or something irreversible, reply needs_decision saying why it is his, with your recommendation.",
].join(" ");

/** What Flyd tells a domain boss whose question for George failed the final output check. */
export const RESTATE_FOR_GEORGE = "Flyd has not put your question to George because its wording is not fit to show him. Restate the decision in plain words: the choice, its real alternatives and your recommendation, without naming internal roles or promising future work.";

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

export const HELD_FOR_ATTENTION = "already returned to its boss once; held for Flyd's attention";

const BOSS_NOTES = [HANDLE_IT_YOURSELF, RECOVER_IT_YOURSELF, RESTATE_FOR_GEORGE];

/** The hand-back notes Flyd has delivered on a run; George's own answers and check-ins are not among them. */
export function notesSentToBoss(messages: ReadonlyArray<{ from?: string; body: string; deliveredAt?: string }> = []): string[] {
  return [...new Set(messages.filter((message) => message.from === "flyd" && message.deliveredAt && BOSS_NOTES.includes(message.body)).map((message) => message.body))];
}

export function bossMessageKind(text: string): "decision" | "question" {
  return text === HANDLE_IT_YOURSELF || text === RECOVER_IT_YOURSELF ? "decision" : "question";
}

type HeldDecision = Extract<ExecutiveDecisionRecord, { disposition: "backstage" }>;
type AskDecision = Extract<ExecutiveDecisionRecord, { disposition: "ask_george" }>;

/** Sends the item back to its own boss once when policy grants a message to that task; otherwise it stays held. */
function toBoss(input: ExecutiveDecisionInput, held: HeldDecision, text: string, reason: string): ExecutiveDecisionRecord {
  const grant = input.taskId ? input.authority?.find((candidate) => candidate.capability === "firstmate.message" && candidate.target === input.taskId) : undefined;
  if (!grant || !input.taskId) return held;
  if (input.sentToBoss?.includes(text)) return { ...held, reason: HELD_FOR_ATTENTION };
  return {
    ...held,
    disposition: "handle_internally",
    reason,
    action: { capability: "firstmate.message", grantId: grant.grantId, target: input.taskId, text, idempotencyKey: `executive:${held.decisionId}:${grant.grantId}` },
    verification: { status: "pending", evidenceRefs: [] },
  };
}

function decide(input: ExecutiveDecisionInput, now = new Date()): ExecutiveDecisionRecord {
  const { proposal, judgment } = input;
  const evidenceRefs = groundedRefs(input);
  const decisionId = digest(`${input.sourceId}\0${input.sourceEventId}`).slice(0, 32);
  const verification = input.verification ?? { status: "unknown" as const, evidenceRefs: [] };
  const confidence = judgment?.confidence ?? 0;
  const decision: HeldDecision = {
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
    if (!input.sentToBoss?.includes(HANDLE_IT_YOURSELF) && (judgment?.route !== "ask_george" || confidence < MIN_CONFIDENCE)) {
      const returned = toBoss(input, decision, HANDLE_IT_YOURSELF, "not judged George's; returned to its boss once");
      if (returned !== decision) return returned;
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
      return toBoss(input, { ...decision, reason: "no matching deterministic authority grant and grounded high-confidence interpretation" },
        RECOVER_IT_YOURSELF, "the status request was not confirmed; returned to its boss");
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

  const held = { ...decision, reason: proposal.kind === "routine" ? "routine operational state stays backstage" : "interpretation is unclear" };
  return input.sourceFailed ? toBoss(input, held, RECOVER_IT_YOURSELF, "failed work returned to its boss") : held;
}

function fenced(decision: ExecutiveDecisionRecord): boolean {
  const displayed = [decision.question ?? decision.summary, ...(decision.options ?? []), decision.recommendation?.rationale ?? ""].join("\n");
  return relayShortfalls(displayed).length > 0 || /\b(?:I|we|Flyd)(?:['’]ll|\s+will|\s+(?:am|are|is)\s+going\s+to)\b/i.test(displayed);
}

function plainWords(text: string): string {
  return BACKSTAGE_ROLES.reduce((said, name) => said.replace(new RegExp(`(?:\\bthe\\s+)?(?:${name.source})`, `${name.flags.replace("g", "")}g`), "the team"), text)
    .replace(/\s+/g, " ").trim();
}

/** After one restate request, Flyd asks George itself, in its own words, dropping alternatives it cannot say cleanly. */
function plainAsk(decision: AskDecision, held: HeldDecision): ExecutiveDecisionRecord {
  const clarify = { rationale: "I recommend clarifying the alternatives before acting." };
  for (const question of [decision.question, decision.summary].map(plainWords).filter(Boolean)) {
    const withOptions: AskDecision = {
      ...decision,
      reason: "its boss was asked to restate it once; Flyd asks in its own words",
      question,
      options: decision.options.map(plainWords),
      recommendation: decision.recommendation.option
        ? { option: plainWords(decision.recommendation.option), rationale: plainWords(decision.recommendation.rationale) }
        : { rationale: plainWords(decision.recommendation.rationale) },
    };
    if (!fenced(withOptions)) return withOptions;
    const withoutOptions: AskDecision = { ...withOptions, options: [], recommendation: clarify };
    if (!fenced(withoutOptions)) return withoutOptions;
  }
  return { ...held, reason: HELD_FOR_ATTENTION };
}

/** Output checks remain the final fence after interpretation, policy and verification. */
export function decideExecutiveStep(input: ExecutiveDecisionInput, now = new Date()): ExecutiveDecisionRecord {
  const decision = decide(input, now);
  if (!decision.show || !fenced(decision)) return decision;
  const held: HeldDecision = { schema: decision.schema, decisionId: decision.decisionId, sourceId: decision.sourceId, sourceEventId: decision.sourceEventId, ...(decision.taskId ? { taskId: decision.taskId } : {}), createdAt: decision.createdAt, summary: decision.summary, evidenceRefs: decision.evidenceRefs, verification: { status: "unknown", evidenceRefs: [] }, disposition: "backstage", show: false, notify: false, reason: "the final output check held this wording" };
  if (decision.disposition !== "ask_george") return held;
  return input.sentToBoss?.includes(RESTATE_FOR_GEORGE) ? plainAsk(decision, held)
    : toBoss(input, held, RESTATE_FOR_GEORGE, "the final output check held a George decision; its boss is asked to restate it");
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
