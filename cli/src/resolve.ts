import { randomUUID } from "node:crypto";
import type { ConversationTurn } from "./conversation-history.js";
import { query } from "./lib/llm.js";
import { readContextBundles, type ContextBundle } from "./lib/context-bundles.js";
import { buildIntelligenceState, IntelligenceState } from "./export-state.js";
import type { Resolution, NativeOperation, ResolutionMode, AugmentOperation } from "./resolve-types.js";
import { validateResolution } from "./resolve-types.js";
import { assessConsequence } from "./consequence.js";
import { classifyRoute, type RouterConfig } from "./router.js";
import type { ConsequenceAssessment } from "./verification-types.js";
import {
  recordDeterministicResolution,
  recordLlmResolution,
  recordRouteSource,
  recordRouteDivergence,
  recordConsequentialFlagged,
} from "./overlay-metrics.js";

interface EnvironmentCapture {
  application: {
    bundle_id: string;
    name: string;
  };
  surface?: {
    kind: string;
    host?: string;
    title?: string;
  };
  window: {
    title: string;
    ref: string;
  };
  focused_element: {
    ref: string;
    role: string;
    description: string;
    value: string;
    placeholder: string;
    selected_text: string;
  };
  semantic_neighbourhood?: {
    parent_type?: string;
    context: Record<string, string>;
  };
  selection: string;
  sufficiency: "semantic" | "partial";
}

export type IntentRouteKind = "dictate_insert" | "draft_insert" | "ask_answer";
export type IntentPlacement = "insert_at_cursor" | "answer_panel";
export type IntentScene =
  | "clean_dictation"
  | "email_reply"
  | "support_reply"
  | "code_review_comment"
  | "meeting_note"
  | "concise_answer";

export interface IntentRoute {
  kind: IntentRouteKind;
  placement: IntentPlacement;
  scene: IntentScene;
}

export interface ManifestRequest {
  invocation_id: string;
  environment_revision: number;
  environment: EnvironmentCapture;
  intent: string;
  modality: "text" | "voice";
  conversation_id?: string;
  /** Base64-encoded JPEG of the user's screen at invocation time (no data: prefix). */
  screenshot?: string;
  invocation_fingerprint: {
    app: string;
    surface?: string;
    window: string;
    element: string;
  };
}

export interface RetrievedClaim {
  claimId: string;
  content: string;
  kind: "fact" | "preference" | "constraint" | "procedure" | "decision" | "hypothesis" | "state" | "observation";
  scope: "global" | "project" | "task" | "session" | "environment";
  epistemicStatus: string;
  epistemicConfidence: number;
  freshness: number;
  sourceRefs: string[];
  relevance: number;
}

export interface ConflictPair {
  claimA: RetrievedClaim;
  claimB: RetrievedClaim;
}

export interface KnowledgeGap {
  question: string;
  project?: string;
  importance: "low" | "medium" | "high";
  status: "open" | "resolved";
}

export interface MemoryPack {
  current: RetrievedClaim[];
  relevant: RetrievedClaim[];
  conflicts: ConflictPair[];
  gaps: KnowledgeGap[];
  sources: string[];
}

const MEMORY_RETRIEVAL_TIMEOUT_MS = 1500;
const MEMORY_EXCERPT_MAX_CHARS = 400;
const MAX_MEMORIES = 5;

function memoryKind(body: string, metadata: Record<string, unknown>): RetrievedClaim["kind"] {
  const type = String(metadata.type ?? "");
  if (type === "preference" || type === "constraint") return type;
  if (type === "decision" || type === "goal") return "decision";
  if (type === "project") return "state";
  return "observation";
}

function memoryScope(metadata: Record<string, unknown>): RetrievedClaim["scope"] {
  const scope = String(metadata.scope ?? "");
  if (scope === "project" || scope === "task" || scope === "session") return scope;
  if (metadata.type === "project" || metadata.type === "goal") return "project";
  return "global";
}

export async function buildMemoryPack(intent: string, _environment: EnvironmentCapture): Promise<MemoryPack> {
  const query = intent.trim();
  const empty: MemoryPack = { current: [], relevant: [], conflicts: [], gaps: [], sources: [] };
  if (!query) return empty;

  try {
    const { retrieveResilientLexicalBrainEvidence } = await import("./lib/brain-retrieval.js");
    const timeout = new Promise<null>((res) => setTimeout(() => res(null), MEMORY_RETRIEVAL_TIMEOUT_MS).unref?.());
    const result = await Promise.race([retrieveResilientLexicalBrainEvidence(query), timeout]);
    if (!result) return empty;

    const conflictingPaths = new Set<string>();
    const relevant: RetrievedClaim[] = [];
    const sources = new Set<string>();

    for (const match of result.matches.slice(0, MAX_MEMORIES)) {
      const p = match.confidenceProfile;
      const claim: RetrievedClaim = {
        claimId: match.id,
        content: match.content.excerpt.slice(0, MEMORY_EXCERPT_MAX_CHARS),
        kind: memoryKind(match.content as unknown as Record<string, unknown>, {}),
        scope: "global",
        epistemicStatus: match.epistemicStatus,
        epistemicConfidence: p.epistemicConfidence,
        freshness: p.freshness,
        sourceRefs: [match.content.path],
        relevance: match.confidence,
      };
      relevant.push(claim);
      sources.add(match.content.path);

      if (match.epistemicStatus === "contradictory") {
        conflictingPaths.add(match.content.path);
      }
    }

    const conflicts: ConflictPair[] = [];
    const contradictory = result.matches.filter(m => m.epistemicStatus === "contradictory");
    for (let i = 0; i < contradictory.length - 1; i++) {
      for (let j = i + 1; j < contradictory.length; j++) {
        conflicts.push({
          claimA: {
            claimId: contradictory[i].id,
            content: contradictory[i].content.excerpt.slice(0, MEMORY_EXCERPT_MAX_CHARS),
            kind: "observation",
            scope: "global",
            epistemicStatus: contradictory[i].epistemicStatus,
            epistemicConfidence: contradictory[i].confidenceProfile.epistemicConfidence,
            freshness: contradictory[i].confidenceProfile.freshness,
            sourceRefs: [contradictory[i].content.path],
            relevance: contradictory[i].confidence,
          },
          claimB: {
            claimId: contradictory[j].id,
            content: contradictory[j].content.excerpt.slice(0, MEMORY_EXCERPT_MAX_CHARS),
            kind: "observation",
            scope: "global",
            epistemicStatus: contradictory[j].epistemicStatus,
            epistemicConfidence: contradictory[j].confidenceProfile.epistemicConfidence,
            freshness: contradictory[j].confidenceProfile.freshness,
            sourceRefs: [contradictory[j].content.path],
            relevance: contradictory[j].confidence,
          },
        });
      }
    }

    return { current: [], relevant, conflicts, gaps: [], sources: [...sources] };
  } catch {
    return empty;
  }
}

// Modeled on MEMORY_OVERVIEW_QUESTION in runtime/shared-memory-retrieval.ts,
// but scoped to the overlay path: questions about the user themselves get the
// compiled context bundles injected on top of normal retrieval.
const IDENTITY_INTENT =
  /\b(who am i|about me\b|about myself|my (background|identity|bio|profile|memories|cv|resume)|what do you (know|remember|have) (about|on) me|do you (know|remember) me)\b/i;

const FIRST_PERSON = /\b(i|me|my|mine|myself|we|our|us)\b/i;
const VOICE_BACKGROUND_REFERENCE =
  /\b(i|my|mine|myself|we|our|ours|ourselves|us)\b/i;

export function isIdentityIntent(intent: string): boolean {
  return IDENTITY_INTENT.test(intent);
}

// Bundles are cheap (~1k tokens) and the prompt instructs silent use, so err
// broad: any answer-routed question that references the user's own life gets
// personal context, not just explicit "about me" phrasings. Recall questions
// like "what am I doing on wednesday?" or "what was that project last year?"
// depend on this.
export function shouldInjectPersonalContext(intent: string, route: IntentRoute): boolean {
  if (isIdentityIntent(intent)) return true;
  return route.kind === "ask_answer" && FIRST_PERSON.test(intent);
}

function shouldIncludeVoiceBackground(intent: string): boolean {
  return isIdentityIntent(intent) || VOICE_BACKGROUND_REFERENCE.test(intent);
}

export function buildResolutionPrompt(
  worldState: IntelligenceState,
  environment: EnvironmentCapture,
  intent: string,
  route: IntentRoute,
  memoryPack: MemoryPack = { current: [], relevant: [], conflicts: [], gaps: [], sources: [] },
  hasScreenshot = false,
  personalContext: ContextBundle[] = [],
  consequence?: ConsequenceAssessment,
  conversationTurns: ConversationTurn[] = [],
  isVoiceConversation = false
): string {
  const app = environment.application.name;
  const bundleId = environment.application.bundle_id;
  const elementRole = environment.focused_element.role;
  const elementDesc = environment.focused_element.description;
  const elementValue = environment.focused_element.value;
  const selection = environment.focused_element.selected_text || environment.selection;
  const neighbourhood = environment.semantic_neighbourhood;

  let contextBlock = "";

  if (neighbourhood?.parent_type === "email_thread") {
    const ctx = neighbourhood.context;
    contextBlock = `\nEmail context: subject="${ctx.subject || "unknown"}", from="${ctx.from || "unknown"}", preview="${ctx.preview || "unknown"}"`;
  }

  const includeBackgroundContext = !isVoiceConversation || shouldIncludeVoiceBackground(intent);
  const goals = includeBackgroundContext
    ? worldState.goals.map((g) => g.content).filter(Boolean).slice(0, 3)
    : [];
  const tensions = includeBackgroundContext
    ? worldState.tensions.map((t) => t.content).filter(Boolean).slice(0, 2)
    : [];

  const summarizeEntry = (entry: Record<string, unknown>): string => {
    const s = entry as Record<string, unknown>;
    return String(s.description || s.title || s.name || s.summary || s.value || s.label || "");
  };

  const profile = (includeBackgroundContext ? worldState.profile : [])
    .map((p) => summarizeEntry(p.content))
    .filter(Boolean)
    .filter((s) => !/\d+\s+(wiki|graph|edge|page|node|file|entry|entries)/i.test(s))
    .slice(0, 5);

  const knowledge = (includeBackgroundContext ? worldState.knowledge : [])
    .map((k) => summarizeEntry(k.content))
    .filter(Boolean)
    .filter((s) => !/\d+\s+(wiki|graph|edge|page|node|file|entry|entries)/i.test(s))
    .slice(0, 3);

  const profileBlock = profile.length > 0
    ? `\nABOUT THE USER:\n${profile.map((p) => `- ${p}`).join("\n")}`
    : "";

  const knowledgeBlock = knowledge.length > 0
    ? `\nRELEVANT CONTEXT:\n${knowledge.map((k) => `- ${k}`).join("\n")}`
    : "";

  const statusLabel = (epistemicStatus: string): string => {
    const labels: Record<string, string> = {
      verified: "verified · high confidence",
      working_assumption: "working · medium confidence",
      speculative: "speculative · low confidence",
      questioned: "questioned",
      unresolved: "unresolved",
      contradictory: "contradictory · uncertain",
      dormant: "dormant",
      episodic: "episodic",
      observation: "observed",
      user_confirmed: "user-confirmed · high confidence",
    };
    return labels[epistemicStatus] ?? epistemicStatus;
  };

  const claimLines = (includeBackgroundContext ? memoryPack.relevant : []).map((c) => {
    const label = statusLabel(c.epistemicStatus);
    return `- [${label}] ${c.content}`;
  });

  const conflictLines = (includeBackgroundContext ? memoryPack.conflicts : []).map((pair) =>
    `- ⚠ Competing claims:\n  a) [${statusLabel(pair.claimA.epistemicStatus)}] ${pair.claimA.content}\n  b) [${statusLabel(pair.claimB.epistemicStatus)}] ${pair.claimB.content}\n  CONFLICT — do not assume either. Ask if critical to this response.`
  );

  const gapLines = (includeBackgroundContext ? memoryPack.gaps : []).map((g) =>
    `- [gap · ${g.importance}] ${g.question}`
  );

  const blocks: string[] = [];
  if (claimLines.length > 0) {
    blocks.push(`\nRELEVANT MEMORY (from the user's personal knowledge base — use silently to inform your reply, never cite paths or say "according to my memory"):\n${claimLines.join("\n")}`);
  }
  if (conflictLines.length > 0) {
    blocks.push(`\nCONFLICTING CLAIMS:\n${conflictLines.join("\n")}`);
  }
  if (gapLines.length > 0) {
    blocks.push(`\nKNOWN GAPS:\n${gapLines.join("\n")}`);
  }
  const memoriesBlock = blocks.join("");

  const personalContextBlock = includeBackgroundContext && personalContext.length > 0
    ? `\nPERSONAL CONTEXT (compiled from the user's own memory wiki — authoritative for questions about who the user is, their background, projects, and constraints; use silently, never cite file paths or bundle names):\n${personalContext.map((b) => b.body).join("\n\n")}`
    : "";

  const memoryStatusBlock = includeBackgroundContext && memoryPack.relevant.length === 0 && personalContext.length === 0
    ? `\nMEMORY STATUS: The user HAS a personal memory system (flyd) and you are connected to it. Retrieval ran for this request and found nothing relevant. If the user asks about themselves or their data, say the memory search found nothing relevant to this question — NEVER claim you lack access to memory or personal information.`
    : "";

  const screenshotBlock = hasScreenshot
    ? `\nSCREEN: The attached image is the user's full screen at the moment they invoked you. Read it. Infer what they are working on, what is visible, and what they most likely mean — even when no text is selected and the focused element is empty.`
    : "";

  const sceneInstruction = scenePrompt(route.scene);

  const consequenceBlock = consequence?.class === "consequential"
    ? `\nCONSEQUENCE NOTE: Fulfilling this intent involves an action beyond the focused text field (${consequence.verbs.join(", ") || "external action"}). You DRAFT; you never perform that action — the user does. Never write copy implying the action already happened ("Sent!", "Deployed", "Deleted"). Produce the draft or the answer, nothing more.`
    : "";

  const conversationBlock = conversationTurns.length > 0
    ? `\nRECENT CONVERSATION (oldest to newest; use this to understand follow-ups):\n${conversationTurns
      .slice(-10)
      .map((turn) => `User: ${turn.user}\nFlyd: ${turn.assistant}`)
      .join("\n")}`
    : "";

  const spokenConversationBlock = isVoiceConversation
    ? `\nSPOKEN CONVERSATION STYLE:
- Answer like a thoughtful person speaking naturally, not like a report or assistant template.
- Use one to three natural sentences unless the user explicitly asks for detail.
- Do not use Markdown, headings, bullets, labels, or bold formatting.
- Do not volunteer personal, project, deadline, or memory context. Use background context only when the user directly asks about it or it is necessary to answer accurately.
- Lead with the answer. Omit preambles, repeated framing, and generic reassurance.`
    : "";

  return `You are Flyd, an intelligent overlay assistant. You are invoked by the user while they are working in another application. Your job is to resolve their intent into concrete operations that the Mac adapter can execute.

The user wants fast, high-quality help inside their current app. Use profile, goals, memories, and knowledge only when they directly improve the reply. Never recite database records, extracted fields, source names, or memory metadata. For replies, drafts, rewrites, and explanations, write polished natural language that could be used as-is.${profileBlock}${knowledgeBlock}${personalContextBlock}${memoriesBlock}${memoryStatusBlock}${screenshotBlock}

ROUTE DECISION:
- Kind: ${route.kind}
- Placement: ${route.placement}
- Scene: ${route.scene}
- Writing instruction: ${sceneInstruction}${consequenceBlock}${spokenConversationBlock}

CURRENT CONTEXT:
- Application: ${app} (${bundleId})
- Focused element: ${elementRole} — ${elementDesc}
- Element value: "${elementValue}"
- Selected text: "${selection}"${contextBlock}
- Sufficiency: ${environment.sufficiency}${conversationBlock}

USER INTENT: "${intent}"

RELEVANT USER GOALS:
${goals.length > 0 ? goals.map((g) => `- ${g}`).join("\n") : "- No active goals"}

ACTIVE TENSIONS:
${tensions.length > 0 ? tensions.map((t) => `- ${t}`).join("\n") : "- No active tensions"}

RESOLUTION RULES:
1. You MUST target only the focused element ref "el_01". Never invent targets.
2. The ROUTE DECISION is authoritative. If placement is "insert_at_cursor", use mode "native" with insert_text. If placement is "answer_panel", use mode "requires_augment".
3. Maximum 2000 characters per operation.
4. If the intent is a GENERAL QUESTION that is unrelated to editing the focused element, return mode "requires_augment" with a concise answer. NEVER insert general knowledge answers into the focused element.
5. If the intent requires showing choices or explanations that cannot fit in text operations, return mode "requires_augment" with augmentations.
6. If the intent genuinely requires a composed surface (investigation, comparison, multi-step workflow), return mode "requires_compose" with a rationale. This should be rare.
7. If the selection is empty and the intent is to rewrite something, use replace_text on the full element value.
8. If selection is non-empty and intent is to rewrite/replace, use replace_selection.
9. For replies (email, chat), infer the reply content and use insert_text.
10. Drafts and replies should be concise, specific, and human. Avoid generic assistant preambles, database-like summaries, and overexplaining.
11. Do not expose a translate mode. If the user asks for translated wording, treat it as draft text to insert.
12. NEVER narrate your own context visibility. Forbidden: "I can see you are using X", "no text is selected", "I don't have a focused element", "if you select some code". An empty selection is NOT a reason to decline — answer the intent from the screen image, memories, and context. Only if the intent is genuinely unanswerable, ask ONE specific clarifying question instead.

Respond with ONLY a JSON object in this format (no other text):

For native (text editing) mode:
{
  "resolution_id": "<uuid>",
  "invocation_id": "<echo from request>",
  "mode": "native",
  "rationale": "<one sentence>",
  "operations": [{ "target": "el_01", "kind": "insert_text", "text": "<content>" }]
}

For augment (show answer to user) mode:
{
  "resolution_id": "<uuid>",
  "invocation_id": "<echo from request>",
  "mode": "requires_augment",
  "rationale": "<one sentence>",
  "augmentations": [{ "kind": "explanation", "content": "<answer text>", "placement": "cursor" }]
}

For compose (needs full surface) mode:
{
  "resolution_id": "<uuid>",
  "invocation_id": "<echo from request>",
  "mode": "requires_compose",
  "rationale": "<one sentence>",
  "composeRationale": "<why a composed surface is needed>"
}`;
}

function scenePrompt(scene: IntentScene): string {
  switch (scene) {
    case "email_reply":
      return "Write a concise, specific email or chat reply. Match the thread context when available. No assistant preamble.";
    case "support_reply":
      return "Write a helpful support reply with acknowledgement and clear next steps. Do not promise facts not provided.";
    case "code_review_comment":
      return "Write a concise engineering comment that is specific, actionable, and respectful.";
    case "meeting_note":
      return "Write clear meeting-style notes with decisions and action items only if they were stated.";
    case "concise_answer":
      return "Answer directly in natural language. Keep it short unless the user asks for detail.";
    case "clean_dictation":
      return "Lightly clean dictation for readability while preserving the user's wording and meaning.";
  }
}

export function parseResolutionResponse(
  raw: string,
  invocationId: string
): Resolution {
  let jsonStr = raw.trim();

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  const parsed = JSON.parse(jsonStr);

  return {
    resolutionId: parsed.resolution_id || parsed.resolutionId || randomUUID(),
    invocationId,
    environmentRevision: 0,
    mode: (parsed.mode as ResolutionMode) || "native",
    rationale: parsed.rationale || "Resolved intent.",
    operations: Array.isArray(parsed.operations)
      ? parsed.operations.map((op: Record<string, unknown>) => ({
          target: (op.target as string) || "el_01",
          kind: (op.kind as NativeOperation["kind"]) || "insert_text",
          text: (op.text as string) || "",
        }))
      : [],
    augmentations: normalizeAugmentations(parsed.augmentations),
    composeRationale: parsed.compose_rationale || parsed.composeRationale || undefined,
  };
}

export function enforceRoutePlacement(resolution: Resolution, route: IntentRoute): Resolution {
  if (route.placement === "answer_panel" && resolution.mode === "native") {
    const content = firstOperationText(resolution) || resolution.rationale;
    return {
      ...resolution,
      mode: "requires_augment",
      rationale: resolution.rationale || "Answering in Flyd.",
      operations: [],
      augmentations: [{ kind: "explanation", content, placement: "cursor" }],
      composeRationale: undefined,
      composeUrl: undefined,
    };
  }

  if (route.placement === "insert_at_cursor" && resolution.mode === "requires_augment") {
    const text = firstAugmentationText(resolution) || resolution.rationale;
    return {
      ...resolution,
      mode: "native",
      rationale: resolution.rationale || "Writing into the focused field.",
      operations: [{ target: "el_01", kind: "insert_text", text }],
      augmentations: [],
      composeRationale: undefined,
      composeUrl: undefined,
    };
  }

  return resolution;
}

function firstOperationText(resolution: Resolution): string {
  return resolution.operations
    .map((operation) => operation.text.trim())
    .find(Boolean) || "";
}

function firstAugmentationText(resolution: Resolution): string {
  return (resolution.augmentations || [])
    .map((augmentation) => augmentation.content.trim())
    .find(Boolean) || "";
}

function normalizeAugmentations(value: unknown): AugmentOperation[] {
  if (!Array.isArray(value)) return [];

  const normalized: AugmentOperation[] = [];

  for (const augmentation of value) {
    if (!augmentation || typeof augmentation !== "object") continue;
    const entry = augmentation as Record<string, unknown>;
    const content = String(entry.content || entry.text || "").trim();
    if (!content) continue;

    const rawKind = String(entry.kind || entry.type || "explanation");
    const kind: AugmentOperation["kind"] =
      rawKind === "choice" || rawKind === "annotation" || rawKind === "control"
        ? rawKind
        : "explanation";

    const rawPlacement = String(entry.placement || "cursor");
    const placement: AugmentOperation["placement"] =
      rawPlacement === "beside_selection" || rawPlacement === "below_element" || rawPlacement === "cursor"
        ? rawPlacement
        : "cursor";

    const normalizedAugmentation: AugmentOperation = { kind, content, placement };
    if (Array.isArray(entry.options)) {
      normalizedAugmentation.options = entry.options
        .filter((option): option is string => typeof option === "string")
        .slice(0, 4);
    }
    normalized.push(normalizedAugmentation);
  }

  return normalized;
}

const QUESTION_STARTS = /^(what|how|why|who|when|where|can|could|shall|should|is|are|do|does|did|will|would|which|whose|whom)\b/i;
const ANSWER_PREFIXES = /^(tell me|show me|explain|describe|summarize|analyze|search|find|look up|look for)\b/i;
const DRAFT_PREFIXES = /^(reply|answer|respond|draft|compose|write|send|rewrite|rephrase|paraphrase|fix|correct|edit|change|replace|translate)\b/i;
const SUPPORT_CONTEXT = /\b(support|customer|ticket|refund|bug report|issue)\b/i;
const CODE_CONTEXT = /\b(code review|pull request|pr|diff|commit|bug|implementation)\b/i;
const MEETING_CONTEXT = /\b(meeting|standup|notes|action items|decisions)\b/i;

export function routeIntent(
  intent: string,
  env: EnvironmentCapture,
  modality: ManifestRequest["modality"]
): IntentRoute {
  const text = intent.trim();
  const lower = text.toLowerCase();

  if (QUESTION_STARTS.test(lower) && !DRAFT_PREFIXES.test(lower)) {
    return { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" };
  }

  if (ANSWER_PREFIXES.test(lower)) {
    return { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" };
  }

  if (DRAFT_PREFIXES.test(lower)) {
    return { kind: "draft_insert", placement: "insert_at_cursor", scene: draftScene(intent, env) };
  }

  if (modality === "voice") {
    return { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" };
  }

  return { kind: "draft_insert", placement: "insert_at_cursor", scene: draftScene(intent, env) };
}

function draftScene(intent: string, env: EnvironmentCapture): IntentScene {
  const haystack = [
    intent,
    env.application.name,
    env.focused_element.description,
    env.semantic_neighbourhood?.parent_type || "",
  ].join(" ");

  if (CODE_CONTEXT.test(haystack)) return "code_review_comment";
  if (SUPPORT_CONTEXT.test(haystack)) return "support_reply";
  if (MEETING_CONTEXT.test(haystack)) return "meeting_note";
  return "email_reply";
}

const DETERMINISTIC_PATTERNS: Array<{
  match: (intent: string, env: EnvironmentCapture) => boolean;
  resolve: (intent: string, env: EnvironmentCapture, invocationId: string) => Resolution;
}> = [
  {
    match: (intent) => /^type\s/i.test(intent),
    resolve: (intent, _env, invocationId) => {
      const text = intent.replace(/^type\s+/i, "");
      return {
        resolutionId: randomUUID(),
        invocationId,
        environmentRevision: 0,
        mode: "native",
        rationale: "Typing text into the focused field.",
        operations: [{ target: "el_01", kind: "insert_text", text }],
      };
    },
  },
  {
    match: (intent) => /^(hello|hi|hey|yo)\b/i.test(intent) && intent.split(/\s+/).length <= 2,
    resolve: (_intent, _env, invocationId) => ({
      resolutionId: randomUUID(),
      invocationId,
      environmentRevision: 0,
      mode: "native",
      rationale: "Simple greeting.",
      operations: [{ target: "el_01", kind: "insert_text", text: "Hello! " }],
    }),
  },
];

export async function resolve(
  manifest: ManifestRequest,
  model?: string,
  apiKey?: string,
  baseURL?: string,
  router?: RouterConfig | null,
  conversationTurns: ConversationTurn[] = []
): Promise<Resolution> {
  const { invocation_id, environment_revision, environment, intent, modality } = manifest;

  // Heuristic consequence check gates the deterministic tier. The patterns
  // below only insert literal text, but consequential intents must never
  // skip model review — cheap insurance before operation kinds grow.
  const heuristicConsequence = assessConsequence(intent);
  if (modality === "text" && heuristicConsequence.class === "benign") {
    for (const pattern of DETERMINISTIC_PATTERNS) {
      if (pattern.match(intent, environment)) {
        const resolution = pattern.resolve(intent, environment, invocation_id);
        resolution.environmentRevision = environment_revision;
        const validationError = validateResolution(resolution);
        if (!validationError) {
          recordDeterministicResolution();
          return resolution;
        }
      }
    }
  }

  // Classifier latency hides under the memory-retrieval budget; regex
  // routing is the fallback, not the primary.
  const [worldState, memoryPack, classified] = await Promise.all([
    Promise.resolve().then(buildIntelligenceState),
    buildMemoryPack(intent, environment),
    classifyRoute(
      intent,
      { appName: environment.application.name, elementRole: environment.focused_element.role },
      modality,
      router ?? null
    ),
  ]);

  const regexRoute = routeIntent(intent, environment, modality);
  const route = modality === "voice" && regexRoute.kind === "ask_answer"
    ? regexRoute
    : classified?.route ?? regexRoute;
  const consequence = classified?.consequence ?? heuristicConsequence;

  let personalContext: ContextBundle[] = [];
  if (shouldInjectPersonalContext(intent, route)) {
    try {
      personalContext = readContextBundles();
    } catch {
      // bundles unavailable — retrieval and MEMORY STATUS still cover the prompt
    }
  }

  if (classified) {
    recordRouteSource("classifier");
    if (classified.route.kind !== regexRoute.kind || classified.route.placement !== regexRoute.placement) {
      recordRouteDivergence();
    }
  } else {
    recordRouteSource(router ? "regex_fallback" : "regex_unconfigured");
  }
  if (consequence.class === "consequential") {
    recordConsequentialFlagged();
  }
  recordLlmResolution();

  const prompt = buildResolutionPrompt(
    worldState,
    environment,
    intent,
    route,
    memoryPack,
    !!manifest.screenshot,
    personalContext,
    consequence,
    conversationTurns,
    modality === "voice"
  );
  const systemPrompt =
    "You are Flyd's resolution engine. You convert user intents into executable operations. Respond with ONLY valid JSON.";

  try {
    const response = await query(prompt, model, systemPrompt, apiKey, baseURL, {
      json: true,
      images: manifest.screenshot ? [manifest.screenshot] : undefined,
    });
    let resolution = parseResolutionResponse(response, invocation_id);
    resolution = enforceRoutePlacement(resolution, route);
    resolution.environmentRevision = environment_revision;
    resolution.consequence = consequence;

    const validationError = validateResolution(resolution);
    if (validationError) {
      return {
        resolutionId: randomUUID(),
        invocationId: invocation_id,
        environmentRevision: environment_revision,
        mode: "requires_compose",
        rationale: `Resolution validation failed: ${validationError.error}`,
        operations: [],
        composeRationale: `Could not produce a valid resolution for: "${intent}"`,
      };
    }

    return resolution;
  } catch (err) {
    return {
      resolutionId: randomUUID(),
      invocationId: invocation_id,
      environmentRevision: environment_revision,
      mode: "requires_compose",
      rationale: "Resolution failed.",
      operations: [],
      composeRationale: err instanceof Error ? err.message : "Unknown error during resolution",
    };
  }
}
