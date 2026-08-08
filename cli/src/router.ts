import { query } from "./lib/llm.js";
import type { IntentRoute, IntentRouteKind, IntentPlacement, IntentScene } from "./resolve.js";
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
  needsPersonalContext?: boolean;
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
- consequential: true only if fulfilling the intent would send, submit, publish, purchase, delete, deploy, or otherwise act on something OUTSIDE the focused text field. Drafting text, rewriting, answering questions, and editing the focused text are NOT consequential.
- verbs: subset of ["create","modify","send","purchase","delete","publish"] that apply (empty if not consequential)
- target: "text_in_focus", "external_system", "file_system", or "unknown"

Respond with ONLY this JSON:
{"kind":"...","placement":"...","scene":"...","consequential":false,"verbs":[],"target":"text_in_focus","reason":"<short>"}`;
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

  return {
    route: {
      kind: kind as IntentRouteKind,
      placement: placement as IntentPlacement,
      scene: scene as IntentScene,
    },
    consequence: {
      class: consequential ? "consequential" : "benign",
      verbs: consequential ? verbs : [],
      target: target as ConsequenceAssessment["target"],
      reason: String(parsed.reason || (consequential ? "Classifier marked consequential" : "Classifier marked benign")),
      source: "classifier",
    },
  };
}
