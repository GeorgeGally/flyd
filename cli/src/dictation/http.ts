import { Agent } from "undici";
import { apiModelId, getKey, resolveModelConnection, usesOpenAITransport } from "../lib/config.js";
import { qualifiedModelProvider } from "../runtime/flyd-worker-config.js";

// Dictation latency is dominated by round trips, so its requests share one
// keep-alive pool. fn down warms it (TLS to the transcription and cleanup
// hosts) while George is still speaking; the default pool drops idle sockets
// after 4 s, which a spoken sentence outlasts.

const dispatcher = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 120_000 });
const OPENAI_ORIGIN = "https://api.openai.com";
const WARM_INTERVAL_MS = 30_000;
const lastWarmed = new Map<string, number>();

export function dictationFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, dispatcher } as RequestInit);
}

/** Hosts a dictation will talk to: transcription always, cleanup when a model is set. */
export function dictationOrigins(dictateModel = getKey("FLYD_DICTATE_MODEL")?.trim()): string[] {
  const origins = [OPENAI_ORIGIN];
  if (dictateModel) {
    try {
      const { baseURL } = resolveModelConnection(dictateModel);
      origins.push(baseURL ? new URL(baseURL).origin : OPENAI_ORIGIN);
    } catch {
      // Misconfigured cleanup model: cleanup will fall back; nothing to warm.
    }
  }
  return [...new Set(origins)];
}

/** Fire-and-forget; never awaited by the recording path. */
export function warmDictationHosts(now = Date.now()): void {
  for (const origin of dictationOrigins()) {
    if (now - (lastWarmed.get(origin) ?? 0) < WARM_INTERVAL_MS) continue;
    lastWarmed.set(origin, now);
    dictationFetch(origin, { method: "HEAD", signal: AbortSignal.timeout(5_000) })
      .then((response) => response.body?.cancel())
      .catch(() => {});
  }
}

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
}

export type CompleteText = (request: CompletionRequest) => Promise<string>;

/** One OpenAI-compatible chat completion, no evidence enrichment, no failover. */
export const completeText: CompleteText = async ({ model, system, user, maxTokens, signal }) => {
  if (!usesOpenAITransport(model)) {
    throw new Error(`Dictation cleanup needs an OpenAI-compatible model, got ${model}`);
  }
  const connection = resolveModelConnection(model);
  const provider = qualifiedModelProvider(model);
  const response = await dictationFetch(`${connection.baseURL ?? `${OPENAI_ORIGIN}/v1`}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: apiModelId(model),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(provider === "openrouter"
        ? { max_tokens: maxTokens, temperature: 0, reasoning: { enabled: false } }
        : { max_completion_tokens: maxTokens }),
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Dictation cleanup HTTP ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  return body.choices?.[0]?.message?.content ?? "";
};
