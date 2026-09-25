import { createHash } from "node:crypto";
import type { PredicateCriteria, PredicateEgress, PredicateQuestion, PredicateQuestionType } from "./types.js";

/**
 * System-1 predicate registry: the single declaration of every question FLYD
 * asks (or reserves a threshold for) through Jev. Call sites build their
 * questions, egress projection and thresholds from here, and the replay
 * harness (`replay.ts`) scores the same definitions against frozen traces
 * before any new predicate is switched on.
 *
 * Changing a question's wording, criteria or type must bump its
 * `evaluatorVersion`; recordings made under another fingerprint are stale.
 */

export type PredicateFamily =
  | "interpret"
  | "memory_rerank"
  | "router"
  | "curator"
  | "policy"
  | "front_door"
  | "learning"
  | "model_routing";

/**
 * - `production`: asked by a production call site when Jev is enabled.
 * - `policy_threshold`: threshold reserved in policy; no question is asked yet.
 * - `proposed`: definition only, for replay; no production call site.
 */
export type PredicateStatus = "production" | "policy_threshold" | "proposed";

/** How the consumer uses the answer. */
export type PredicateUse = "gate" | "argmax" | "rank" | "choice" | "recorded" | "none";

/** What production does when Jev is off, errors, or the answer is below threshold. */
export type PredicateFailureMode =
  | "fallback_heuristic"
  | "fallback_llm_classifier"
  | "keep_lexical_order"
  | "fail_open"
  | "skip_mutation"
  | "not_consumed";

export interface PredicateDefinition {
  id: string;
  family: PredicateFamily;
  type: PredicateQuestionType;
  instructions: string;
  criteria?: PredicateCriteria;
  /** Pass threshold on probability (Noul/Score) or confidence (Choice); null when the answer is ranked or read as a choice. */
  threshold: number | null;
  /** Named call-site thresholds that differ from `threshold`. */
  gates?: Readonly<Record<string, number>>;
  use: PredicateUse;
  failureMode: PredicateFailureMode;
  /** Top-level state fields this predicate may send to Jev. */
  projection: readonly string[];
  evaluatorVersion: string;
  status: PredicateStatus;
  /** Where the answer is consumed (or why it is not). */
  consumer: string;
}

const INTERPRET_PROJECTION = ["utterance", "conversation_recap"] as const;
const ROUTER_PROJECTION = ["intent", "app_name", "element_role", "modality"] as const;
const CURATOR_PROJECTION = ["statement", "project_ids", "intent_kind", "temporal_frame", "referents", "source_event"] as const;
const MEMORY_PROJECTION = ["request", "temporal_frame", "candidates"] as const;
const FRONT_DOOR_PROJECTION = ["utterance", "foreground_app", "focused_element_role", "has_selection", "user_projects"] as const;

const interpret = (id: string, instructions: string, extra: Partial<PredicateDefinition> = {}): PredicateDefinition => ({
  id, family: "interpret", type: "noul", instructions,
  threshold: 0.70, use: "argmax", failureMode: "fallback_heuristic",
  projection: INTERPRET_PROJECTION, evaluatorVersion: "interpret.v2", status: "production",
  consumer: "cognition/interpret.ts interpretIntent: argmax over intent Nouls ≥ threshold, else deterministic interpretation",
  ...extra,
});

const routerVerb = (verb: string, instructions: string): PredicateDefinition => ({
  id: `verb_${verb}`, family: "router", type: "noul", instructions,
  threshold: 0.65, use: "gate", failureMode: "fallback_llm_classifier",
  projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
  consumer: "router.ts classifyRouteWithJev: consequence verbs",
});

const policyOnly = (id: string, threshold: number, instructions: string): PredicateDefinition => ({
  id, family: "policy", type: "noul", instructions, threshold, use: "none", failureMode: "not_consumed",
  projection: [], evaluatorVersion: "policy.v1", status: "policy_threshold",
  consumer: "system-one/policy.ts PREDICATE_THRESHOLDS only; no call site asks this question yet",
});

export const PREDICATE_DEFINITIONS: readonly PredicateDefinition[] = [
  // ── interpret (cognition/interpret.ts) ────────────────────────────────
  // Wording is scoped to the user's own state: "true now in the world" is
  // not the user's current state (C6: "who runs OpenAI now").
  interpret("current_state", "Is the user asking about their own current work or personal state: what they themselves are doing, have open, or have active right now? Questions about the outside world (people, companies, prices, news, general knowledge) are not about the user's own state."),
  interpret("task_resume", "Is the user trying to resume or continue their own prior work?"),
  interpret("historical_recall", "Is the user asking about their own past work, past state, or decisions they made before? Questions about public history or world facts do not count."),
  interpret("action", "Is the user asking Flyd to perform or continue an action?"),
  interpret("correction", "Is the user correcting something Flyd said or assumed, or correcting a fact about their own work, plans, or current state?"),
  interpret("needs_deep_memory", "Does answering require the user's own durable memory (their notes, past work, or prior decisions) beyond the current conversation? General or public knowledge does not count.", {
    threshold: 0.6, use: "gate", consumer: "cognition/interpret.ts interpretIntent: needsDeepMemory when Jev decided the intent",
  }),
  interpret("needs_current_state", "Does answering require up-to-date knowledge of the user's own current work state (what they are doing, have open, or have active now)? Current facts about the outside world do not count.", {
    threshold: 0.6, use: "gate", consumer: "cognition/interpret.ts interpretIntent: needsCurrentState when Jev decided the intent",
  }),

  // ── memory rerank (cognition/memory.ts) ───────────────────────────────
  {
    id: "candidate_relevant", family: "memory_rerank", type: "noul",
    instructions: "Is candidate {index} materially useful for answering the user's request now?",
    threshold: null, use: "rank", failureMode: "keep_lexical_order",
    projection: MEMORY_PROJECTION, evaluatorVersion: "memory_rerank.v1", status: "production",
    consumer: "cognition/memory.ts queryMemory: replaces lexical relevance and re-sorts; asked once per candidate as candidate_{index}_relevant",
  },

  // ── router (router.ts) ────────────────────────────────────────────────
  {
    id: "route_kind", family: "router", type: "choice",
    instructions: "Choose the overlay route kind that best matches the user's intent.",
    criteria: {
      ask_answer: "The user wants an answer or explanation shown to them.",
      draft_insert: "The user wants composed or rewritten text inserted into the focused field.",
      dictate_insert: "The user is dictating text to insert nearly verbatim.",
    },
    threshold: null, use: "choice", failureMode: "fallback_llm_classifier",
    projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
    consumer: "router.ts classifyRouteWithJev: route.kind (confidence not yet read)",
  },
  {
    id: "placement", family: "router", type: "choice",
    instructions: "Choose where the result belongs.",
    criteria: {
      answer_panel: "Show the result to the user as an answer.",
      insert_at_cursor: "Insert the result into the focused text field.",
    },
    threshold: null, use: "choice", failureMode: "fallback_llm_classifier",
    projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
    consumer: "router.ts classifyRouteWithJev: route.placement",
  },
  {
    id: "scene", family: "router", type: "choice",
    instructions: "Choose the best writing scene.",
    criteria: {
      clean_dictation: "Lightly cleaned dictation.",
      email_reply: "Email or chat reply.",
      support_reply: "Support response.",
      code_review_comment: "Engineering review comment.",
      meeting_note: "Meeting notes.",
      concise_answer: "Direct answer or explanation.",
    },
    threshold: null, use: "choice", failureMode: "fallback_llm_classifier",
    projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
    consumer: "router.ts classifyRouteWithJev: route.scene",
  },
  {
    id: "purpose", family: "router", type: "choice",
    instructions: "Choose the primary purpose of the request. Prefer the narrowest applicable purpose.",
    criteria: {
      type_text: "The user wants text composed or inserted in the focused field.",
      answer: "The user wants a direct explanation or answer.",
      recall_personal: "The user asks about their prior work, plans, decisions, or personal context.",
      research_web: "The user asks for current external facts, browsing, searching, or investigation.",
      work_help: "The user asks Flyd to diagnose, plan, or advance implementation work.",
      control_flyd: "The user asks to control Flyd itself or its live state.",
    },
    threshold: null, use: "choice", failureMode: "fallback_llm_classifier",
    projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
    consumer: "router.ts classifyRouteWithJev: purpose, falls back to requestPurposeFromRoute",
  },
  {
    id: "consequential", family: "router", type: "noul",
    instructions: "Would fulfilling this intent itself send, submit, publish, purchase, delete, deploy, or otherwise act outside the focused text field?",
    threshold: 0.65, use: "gate", failureMode: "fallback_llm_classifier",
    projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
    consumer: "router.ts classifyRouteWithJev: consequence class (may only escalate the deterministic floor in resolve.ts)",
  },
  {
    id: "target", family: "router", type: "choice",
    instructions: "Choose the primary target of the requested result.",
    criteria: {
      text_in_focus: "Only the currently focused text field.",
      external_system: "A remote or external system.",
      file_system: "The local file system or repository.",
      unknown: "The target cannot be determined.",
    },
    threshold: null, use: "choice", failureMode: "fallback_llm_classifier",
    projection: ROUTER_PROJECTION, evaluatorVersion: "router.v1", status: "production",
    consumer: "router.ts classifyRouteWithJev: consequence target",
  },
  routerVerb("create", "Does the consequential action create an external or durable object?"),
  routerVerb("modify", "Does the consequential action modify an external or durable object?"),
  routerVerb("send", "Does the consequential action send or submit something?"),
  routerVerb("purchase", "Does the consequential action purchase something?"),
  routerVerb("delete", "Does the consequential action delete something?"),
  routerVerb("publish", "Does the consequential action publish or deploy something?"),

  // ── curator (cognition/curator/reconcile.ts) ──────────────────────────
  {
    id: "is_correction", family: "curator", type: "noul",
    instructions: "Is the user correcting a prior fact, assumption, task, or current state?",
    threshold: 0.85, use: "gate", failureMode: "skip_mutation",
    projection: CURATOR_PROJECTION, evaluatorVersion: "curator.v1", status: "production",
    consumer: "cognition/curator/reconcile.ts: records a correction candidate; skipped without Jev",
  },
  {
    id: "changes_current_state", family: "curator", type: "noul",
    instructions: "Does the statement materially change what is currently true or actionable?",
    threshold: 0.85, gates: { lifecycle: 0.80 }, use: "gate", failureMode: "fail_open",
    projection: CURATOR_PROJECTION, evaluatorVersion: "curator.v1", status: "production",
    consumer: "cognition/curator/reconcile.ts: corroborates lifecycle claims (gate lifecycle, treated as passing without Jev) and correction candidates (threshold)",
  },
  {
    id: "marks_completed", family: "curator", type: "noul",
    instructions: "Does the user explicitly state that the referenced project/event/task is completed, over, finished, or already happened?",
    threshold: 0.85, use: "recorded", failureMode: "not_consumed",
    projection: CURATOR_PROJECTION, evaluatorVersion: "curator.v1", status: "production",
    consumer: "cognition/curator/reconcile.ts: asked and recorded in the cognition.system-one observation; the lifecycle decision does not read it yet",
  },
  {
    id: "marks_cancelled", family: "curator", type: "noul",
    instructions: "Does the user explicitly state that the referenced project/event/task is cancelled or no longer happening?",
    threshold: 0.85, use: "recorded", failureMode: "not_consumed",
    projection: CURATOR_PROJECTION, evaluatorVersion: "curator.v1", status: "production",
    consumer: "cognition/curator/reconcile.ts: asked and recorded in the cognition.system-one observation; the lifecycle decision does not read it yet",
  },
  {
    id: "evidence_supported", family: "curator", type: "noul",
    instructions: "Is the proposed state change directly supported by the user's statement itself?",
    threshold: 0.85, gates: { lifecycle: 0.80 }, use: "gate", failureMode: "fail_open",
    projection: CURATOR_PROJECTION, evaluatorVersion: "curator.v1", status: "production",
    consumer: "cognition/curator/reconcile.ts: corroborates lifecycle claims (gate lifecycle, treated as passing without Jev)",
  },

  // ── policy thresholds with no call site yet (system-one/policy.ts) ────
  policyOnly("same_entity", 0.90, "Do the two records refer to the same real-world entity?"),
  policyOnly("supersedes_existing_claim", 0.90, "Does the new claim replace the existing claim about the same attribute?"),
  policyOnly("contradicts_existing_claim", 0.90, "Does the new claim contradict the existing claim about the same attribute?"),
  policyOnly("relevant_to_request", 0.70, "Is this item relevant to the user's request?"),
  policyOnly("useful_as_current_context", 0.72, "Is this item useful as current context for the user's request?"),
  policyOnly("requires_current_verification", 0.75, "Must this claim be verified against current state before it is used?"),
  policyOnly("refers_to_previous_action", 0.80, "Does the user refer to an action Flyd took earlier?"),

  // ── proposed: front-door gate (scout report Ship 1; replay only) ──────
  {
    id: "invocation_mode", family: "front_door", type: "choice",
    instructions: "What does the user want Flyd to do with this invocation?",
    criteria: {
      insert: "Write, rewrite, translate, shorten, or reply with text that goes into the focused field.",
      answer: "Explain or answer something in a card; not about the user's own history or work.",
      recall: "Recall the user's own work: what they are working on, did, decided, or where they left off.",
      work_help: "Diagnose or advance the open artifact or task the user is working on.",
      control: "Control Flyd itself: dismiss, stop, cancel, close.",
    },
    threshold: 0.80, use: "choice", failureMode: "fallback_heuristic",
    projection: FRONT_DOOR_PROJECTION, evaluatorVersion: "front_door.v1", status: "proposed",
    consumer: "none yet: candidate /manifest front-door gate; today every non-dictation intent goes to Work-Intelligence",
  },
  {
    id: "needs_web", family: "front_door", type: "noul",
    instructions: "Does a correct answer depend on public facts that may have changed recently (news, prices, releases, who holds a role, weather)? Questions about the user's own projects in `user_projects`, tasks, files, or history do not count.",
    threshold: 0.60, use: "gate", failureMode: "fallback_heuristic",
    projection: FRONT_DOOR_PROJECTION, evaluatorVersion: "front_door.v1", status: "proposed",
    consumer: "none yet: candidate replacement for the evidence-need regex (evidence/evidence-need.ts classifyEvidenceNeed)",
  },

  // ── proposed: learning from traces (replay only) ──────────────────────
  {
    id: "outcome_supported", family: "learning", type: "noul",
    instructions: "Does `outcome` show positive evidence that `action` achieved what the user asked for in `intent` (the user kept, accepted, used, or verified the result)? The absence of a complaint is not positive evidence.",
    threshold: 0.80, use: "gate", failureMode: "not_consumed",
    projection: ["intent", "action", "outcome"], evaluatorVersion: "outcome_supported.v1", status: "proposed",
    consumer: "none yet: candidate first-pass for the transition outcome judge (transitions/judge.ts, an LLM call today)",
  },
  {
    id: "learning_supported_by_trace", family: "learning", type: "noul",
    instructions: "Is `proposed_learning` directly supported by `trace` as something the user wants applied to future requests (an explicit lasting preference, a correction of Flyd's behaviour, or a procedure they taught), rather than a one-off request, a reminder, or a command?",
    threshold: 0.85, use: "gate", failureMode: "fallback_heuristic",
    projection: ["proposed_learning", "trace"], evaluatorVersion: "learning_supported_by_trace.v1", status: "proposed",
    consumer: "none yet: candidate corroboration for the memory write gate (memory-gate.ts memoryGate, regex today)",
  },

  // ── proposed: model routing (replay only) ─────────────────────────────
  {
    id: "needs_reasoning_model", family: "model_routing", type: "noul",
    instructions: "Does a correct response require multi-step reasoning, planning, debugging, code generation, or weighing several sources, rather than a short direct answer, a simple lookup, a light rewrite of given text, or a command to Flyd?",
    threshold: 0.70, use: "gate", failureMode: "not_consumed",
    projection: ["utterance", "app_name", "has_selection"], evaluatorVersion: "needs_reasoning_model.v1", status: "proposed",
    consumer: "none yet: every invocation that reaches a model uses the main model today",
  },
];

const BY_ID = new Map(PREDICATE_DEFINITIONS.map((definition) => [definition.id, definition]));

export function predicateDefinition(id: string): PredicateDefinition {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`Unknown System-1 predicate: ${id}`);
  return definition;
}

export function familyDefinitions(family: PredicateFamily): PredicateDefinition[] {
  return PREDICATE_DEFINITIONS.filter((definition) => definition.family === family);
}

/** Threshold for a named call-site gate, falling back to the default threshold. */
export function predicateThreshold(id: string, gate?: string): number {
  const definition = predicateDefinition(id);
  const value = (gate ? definition.gates?.[gate] : undefined) ?? definition.threshold;
  if (value === null) throw new Error(`System-1 predicate ${id} has no threshold`);
  return value;
}

/** Wire question for a definition; `{name}` placeholders in the instructions are filled from `vars`. */
export function questionFor(id: string, vars: Record<string, string | number> = {}, questionId = id): PredicateQuestion {
  const definition = predicateDefinition(id);
  const instructions = definition.instructions.replace(/\{(\w+)\}/g, (match, key: string) => key in vars ? String(vars[key]) : match);
  return {
    id: questionId,
    instructions,
    ...(definition.type !== "noul" ? { type: definition.type } : {}),
    ...(definition.criteria ? { criteria: definition.criteria } : {}),
  };
}

export function familyQuestions(family: PredicateFamily): PredicateQuestion[] {
  return familyDefinitions(family).map((definition) => questionFor(definition.id));
}

/** Egress declaration for a family: its purpose and the union of its projections. */
export function familyEgress(family: PredicateFamily): PredicateEgress {
  return {
    purpose: family,
    allowedFields: [...new Set(familyDefinitions(family).flatMap((definition) => definition.projection))],
  };
}

/** Stable fingerprint of what Jev actually sees for this predicate's question. */
export function questionFingerprint(id: string): string {
  const definition = predicateDefinition(id);
  return createHash("sha256")
    .update(JSON.stringify([definition.type, definition.instructions, definition.criteria ?? null]))
    .digest("hex")
    .slice(0, 16);
}
