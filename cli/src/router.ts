import { query } from "./lib/llm.js";
import type { IntentRoute, IntentRouteKind, IntentPlacement, IntentScene } from "./resolve.js";
import { evaluatePredicates } from "./cognition/system-one/jev.js";
import type {
  ConsequenceAssessment,
  ConsequentialVerb,
} from "./verification-types.js";

/**
 * Flash-model route classifier. Replaces first-word regex routing as the
 * primary router; the regex path remains the fallback when this times out,
 * errors, or returns malformed output. Runs inside the existing
 * Promise.all alongside memory retrieval, so its latency hides under the
 * memory budget instead of adding to it.
 */

export interface RouterConfig {
  model: string;
  apiKey: string;
  baseURL: string;
}

export interface DictationCheckInput {
  intent: string;
  modality: "text" | "voice";
  elementRole: string;
}

const DICTATION_PREFIX = /^(type|write|dictate|insert)\s/i;

export function isDeterministicDictation(input: DictationCheckInput): boolean {
  const hasEditableTarget = input.elementRole?.includes("Text") ?? false;
  if (!hasEditableTarget) return false;
  if (input.modality === "voice") return false;
  return DICTATION_PREFIX.test(input.intent);
}

export interface ClassifiedRoute {
  route: IntentRoute;
  consequence: ConsequenceAssessment;
  purpose: RequestPurpose;
  needsPersonalContext?: boolean;
}

export type RequestPurpose = "type_text" | "answer" | "recall_personal" | "research_web" | "work_help" | "control_flyd";

const RESEARCH_REQUEST = /\b(?:search|browse|look up|look for|investigate|research|latest|current news)\b/i;
const RECALL_REQUEST = /\b(?:remember|recall|where were we|what(?:'s| is) left|my\s+(?:plan|project|notes|tasks?))\b/i;
const WORK_REQUEST = /\b(?:implement|build|continue|refactor|debug|test|ship|deploy)\b|\bfix\b.*\b(?:null|bug|function|code|test|build|deploy)\b/i;
const CONTROL_REQUEST = /\b(?:start|stop|open|close|mute|unmute)\s+(?:flyd|live)\b/i;

/**
 * A conservative local purpose gate. It is intentionally independent of
 * hosted Jev so an unavailable classifier never turns an answer into a work
 * intervention. The route owns typing; explicit lexical intent separates
 * personal recall, live research, and work help among answer-panel requests.
 */
export function requestPurposeFromRoute(intent: string, route: IntentRoute): RequestPurpose {
  if (RESEARCH_REQUEST.test(intent)) return "research_web";
  if (RECALL_REQUEST.test(intent)) return "recall_personal";
  if (CONTROL_REQUEST.test(intent)) return "control_flyd";
  if (WORK_REQUEST.test(intent)) return "work_help";
  if (route.placement === "insert_at_cursor") return "type_text";
  return "answer";
}

const ROUTER_TIMEOUT_MS = 800;

const VALID_KINDS: ReadonlySet<string> = new Set(["dictate_insert", "draft_insert", "ask_answer"]);
const VALID_PLACEMENTS: ReadonlySet<string> = new Set(["insert_at_cursor", "answer_panel"]);
const VALID_SCENES: ReadonlySet<string> = new Set([
  "clean_dictation",
  "email_reply",
  "support_reply",
  "code_review_comment",
  "meeting_note",
  "concise_answer",
]);
const VALID_VERBS: ReadonlySet<string> = new Set([
  "create",
  "modify",
  "send",
  "purchase",
  "delete",
  "publish",
]);
const VALID_TARGETS: ReadonlySet<string> = new Set([
  "text_in_focus",
  "external_system",
  "file_system",
  "unknown",
]);
const VALID_PURPOSES: ReadonlySet<string> = new Set([
  "type_text", "answer", "recall_personal", "research_web", "work_help", "control_flyd",
]);

function buildClassifierPrompt(
  intent: string,
  appName: string,
  elementRole: string,
  modality: "text" | "voice"
): string {
  return `Classify this user intent for an overlay assistant. The user is working in "${appName}" with a focused ${elementRole || "element"}. Input modality: ${modality}.

INTENT: "${intent}"

Decide:
- kind: "ask_answer" (user wants an answer/explanation shown to them), "draft_insert" (user wants text written into the focused field), or "dictate_insert" (voice dictation to insert nearly verbatim)
- placement: "answer_panel" for answers, "insert_at_cursor" for text going into the field
- scene: one of "clean_dictation", "email_reply", "support_reply", "code_review_comment", "meeting_note", "concise_answer"
- purpose: "type_text", "answer", "recall_personal", "research_web", "work_help", or "control_flyd"
- consequential: true only if fulfilling the intent would send, submit, publish, purchase, delete, deploy, or otherwise act on something OUTSIDE the focused text field. Drafting text, rewriting, answering questions, and editing the focused text are NOT consequential.
- verbs: subset of ["create","modify","send","purchase","delete","publish"] that apply (empty if not consequential)
- target: "text_in_focus", "external_system", "file_system", or "unknown"

Respond with ONLY this JSON:
{"kind":"...","placement":"...","scene":"...","purpose":"...","consequential":false,"verbs":[],"target":"text_in_focus","reason":"<short>"}`;
}

async function classifyRouteWithJev(
  intent: string,
  env: { appName: string; elementRole: string },
  modality: "text" | "voice",
): Promise<ClassifiedRoute | null> {
  const evaluation = await evaluatePredicates(
    { intent, app_name: env.appName, element_role: env.elementRole, modality },
    [
      {
        id: "route_kind",
        type: "choice",
        instructions: "Choose the overlay route kind that best matches the user's intent.",
        criteria: {
          ask_answer: "The user wants an answer or explanation shown to them.",
          draft_insert: "The user wants composed or rewritten text inserted into the focused field.",
          dictate_insert: "The user is dictating text to insert nearly verbatim.",
        },
      },
      {
        id: "placement",
        type: "choice",
        instructions: "Choose where the result belongs.",
        criteria: {
          answer_panel: "Show the result to the user as an answer.",
          insert_at_cursor: "Insert the result into the focused text field.",
        },
      },
      {
        id: "scene",
        type: "choice",
        instructions: "Choose the best writing scene.",
        criteria: {
          clean_dictation: "Lightly cleaned dictation.",
          email_reply: "Email or chat reply.",
          support_reply: "Support response.",
          code_review_comment: "Engineering review comment.",
          meeting_note: "Meeting notes.",
          concise_answer: "Direct answer or explanation.",
        },
      },
      {
        id: "purpose",
        type: "choice",
        instructions: "Choose the primary purpose of the request. Prefer the narrowest applicable purpose.",
        criteria: {
          type_text: "The user wants text composed or inserted in the focused field.",
          answer: "The user wants a direct explanation or answer.",
          recall_personal: "The user asks about their prior work, plans, decisions, or personal context.",
          research_web: "The user asks for current external facts, browsing, searching, or investigation.",
          work_help: "The user asks Flyd to diagnose, plan, or advance implementation work.",
          control_flyd: "The user asks to control Flyd itself or its live state.",
        },
      },
      { id: "consequential", instructions: "Would fulfilling this intent itself send, submit, publish, purchase, delete, deploy, or otherwise act outside the focused text field?" },
      {
        id: "target",
        type: "choice",
        instructions: "Choose the primary target of the requested result.",
        criteria: {
          text_in_focus: "Only the currently focused text field.",
          external_system: "A remote or external system.",
          file_system: "The local file system or repository.",
          unknown: "The target cannot be determined.",
        },
      },
      { id: "verb_create", instructions: "Does the consequential action create an external or durable object?" },
      { id: "verb_modify", instructions: "Does the consequential action modify an external or durable object?" },
      { id: "verb_send", instructions: "Does the consequential action send or submit something?" },
      { id: "verb_purchase", instructions: "Does the consequential action purchase something?" },
      { id: "verb_delete", instructions: "Does the consequential action delete something?" },
      { id: "verb_publish", instructions: "Does the consequential action publish or deploy something?" },
    ],
  );
  if (!evaluation.ok) return null;
  const kind = evaluation.answers.route_kind?.choice ?? "";
  const placement = evaluation.answers.placement?.choice ?? "";
  const scene = evaluation.answers.scene?.choice ?? "";
  const rawPurpose = evaluation.answers.purpose?.choice ?? "";
  const target = evaluation.answers.target?.choice ?? "unknown";
  if (!VALID_KINDS.has(kind) || !VALID_PLACEMENTS.has(placement) || !VALID_SCENES.has(scene) || !VALID_TARGETS.has(target)) {
    return null;
  }
  const consequential = (evaluation.answers.consequential?.probability ?? 0) >= 0.65;
  const verbs = ([
    ["create", "verb_create"],
    ["modify", "verb_modify"],
    ["send", "verb_send"],
    ["purchase", "verb_purchase"],
    ["delete", "verb_delete"],
    ["publish", "verb_publish"],
  ] as const)
    .filter(([, id]) => (evaluation.answers[id]?.probability ?? 0) >= 0.65)
    .map(([verb]) => verb as ConsequentialVerb);

  const route = { kind: kind as IntentRouteKind, placement: placement as IntentPlacement, scene: scene as IntentScene };
  return {
    route,
    purpose: VALID_PURPOSES.has(rawPurpose) ? rawPurpose as RequestPurpose : requestPurposeFromRoute(intent, route),
    consequence: {
      class: consequential ? "consequential" : "benign",
      verbs: consequential ? verbs : [],
      target: target as ConsequenceAssessment["target"],
      reason: "Jev System-1 bounded route classification",
      source: "classifier",
    },
  };
}

type QueryFn = typeof query;

export async function classifyRoute(
  intent: string,
  env: { appName: string; elementRole: string },
  modality: "text" | "voice",
  config: RouterConfig | null,
  queryFn: QueryFn = query,
  timeoutMs = ROUTER_TIMEOUT_MS
): Promise<ClassifiedRoute | null> {
  const jev = await classifyRouteWithJev(intent, env, modality);
  if (jev) return jev;
  if (!config) return null;

  const prompt = buildClassifierPrompt(intent, env.appName, env.elementRole, modality);
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), timeoutMs).unref?.());

  try {
    const response = await Promise.race([
      queryFn(
        prompt,
        config.model,
        "You are a fast intent router. Respond with ONLY valid JSON.",
        config.apiKey,
        config.baseURL,
        { json: true }
      ),
      timeout,
    ]);
    if (!response) return null;
    return parseClassifierResponse(response);
  } catch {
    return null;
  }
}

export function parseClassifierResponse(raw: string): ClassifiedRoute | null {
  let parsed: Record<string, unknown>;
  try {
    const match = raw.trim().match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    return null;
  }

  const kind = String(parsed.kind || "");
  const placement = String(parsed.placement || "");
  const scene = String(parsed.scene || "");
  if (!VALID_KINDS.has(kind) || !VALID_PLACEMENTS.has(placement) || !VALID_SCENES.has(scene)) {
    return null;
  }

  const consequential = parsed.consequential === true;
  const verbs = Array.isArray(parsed.verbs)
    ? parsed.verbs.filter((v): v is ConsequentialVerb => VALID_VERBS.has(String(v)))
    : [];
  const rawTarget = String(parsed.target || "unknown");
  const target = VALID_TARGETS.has(rawTarget) ? rawTarget : "unknown";
  const route = {
    kind: kind as IntentRouteKind,
    placement: placement as IntentPlacement,
    scene: scene as IntentScene,
  };
  const rawPurpose = String(parsed.purpose || "");

  return {
    route,
    purpose: VALID_PURPOSES.has(rawPurpose) ? rawPurpose as RequestPurpose : requestPurposeFromRoute("", route),
    consequence: {
      class: consequential ? "consequential" : "benign",
      verbs: consequential ? verbs : [],
      target: target as ConsequenceAssessment["target"],
      reason: String(parsed.reason || (consequential ? "Classifier marked consequential" : "Classifier marked benign")),
      source: "classifier",
    },
  };
}
