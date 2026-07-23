import { randomUUID } from "node:crypto";
import { query } from "./lib/llm.js";
import { buildIntelligenceState, IntelligenceState } from "./export-state.js";
import type { Resolution, NativeOperation, ResolutionMode } from "./resolve-types.js";
import { validateResolution } from "./resolve-types.js";

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

export interface ManifestRequest {
  invocation_id: string;
  environment_revision: number;
  environment: EnvironmentCapture;
  intent: string;
  modality: "text" | "voice";
  invocation_fingerprint: {
    app: string;
    surface?: string;
    window: string;
    element: string;
  };
}

function buildResolutionPrompt(
  worldState: IntelligenceState,
  environment: EnvironmentCapture,
  intent: string
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

  const goals = worldState.goals.map((g) => g.content).filter(Boolean).slice(0, 3);
  const tensions = worldState.tensions.map((t) => t.content).filter(Boolean).slice(0, 2);

  return `You are Flyd, an intelligent overlay assistant. You are invoked by the user while they are working in another application. Your job is to resolve their intent into concrete operations that the Mac adapter can execute.

CURRENT CONTEXT:
- Application: ${app} (${bundleId})
- Focused element: ${elementRole} — ${elementDesc}
- Element value: "${elementValue}"
- Selected text: "${selection}"${contextBlock}
- Sufficiency: ${environment.sufficiency}

USER INTENT: "${intent}"

RELEVANT USER GOALS:
${goals.length > 0 ? goals.map((g) => `- ${g}`).join("\n") : "- No active goals"}

ACTIVE TENSIONS:
${tensions.length > 0 ? tensions.map((t) => `- ${t}`).join("\n") : "- No active tensions"}

RESOLUTION RULES:
1. You MUST target only the focused element ref "el_01". Never invent targets.
2. Safe operations only: insert_text, replace_text, replace_selection.
3. Maximum 2000 characters per operation.
4. If you can resolve the intent with the available context, return mode "native" with operations.
5. If the intent would benefit from showing options/explanations but can be resolved, return mode "native".
6. If the intent requires showing choices or explanations that cannot fit in text operations, return mode "requires_augment" with augmentations.
7. If the intent genuinely requires a composed surface (investigation, comparison, multi-step workflow), return mode "requires_compose" with a rationale. This should be rare.
8. If the selection is empty and the intent is to rewrite something, use replace_text on the full element value.
9. If selection is non-empty and intent is to rewrite/replace, use replace_selection.
10. For replies (email, chat), infer the reply content and use insert_text.

Respond with ONLY a JSON object in this format (no other text):

{
  "resolution_id": "<uuid>",
  "invocation_id": "<echo from request>",
  "mode": "native" | "requires_augment" | "requires_compose",
  "rationale": "<one sentence explaining what you're doing>",
  "operations": [
    { "target": "el_01", "kind": "insert_text" | "replace_text" | "replace_selection", "text": "<content>" }
  ],
  "augmentations": [],
  "compose_rationale": null
}`;
}

function parseResolutionResponse(
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
    resolutionId: parsed.resolution_id || randomUUID(),
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
    augmentations: parsed.augmentations || [],
    composeRationale: parsed.compose_rationale || undefined,
  };
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
  model?: string
): Promise<Resolution> {
  const { invocation_id, environment_revision, environment, intent } = manifest;

  for (const pattern of DETERMINISTIC_PATTERNS) {
    if (pattern.match(intent, environment)) {
      const resolution = pattern.resolve(intent, environment, invocation_id);
      resolution.environmentRevision = environment_revision;
      const validationError = validateResolution(resolution);
      if (!validationError) return resolution;
    }
  }

  const worldState = buildIntelligenceState();
  const prompt = buildResolutionPrompt(worldState, environment, intent);
  const systemPrompt =
    "You are Flyd's resolution engine. You convert user intents into executable operations. Respond with ONLY valid JSON.";

  try {
    const response = await query(prompt, model, systemPrompt);
    const resolution = parseResolutionResponse(response, invocation_id);
    resolution.environmentRevision = environment_revision;

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
