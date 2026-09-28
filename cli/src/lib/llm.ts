import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { finalizeEvidenceSurface } from "../evidence/compose-surface.js";
import { enrichResolutionPromptWithEvidence } from "../evidence/resolution-evidence.js";
import { usesOpenAITransport, apiModelId, defaultModel, fallbackModelChain, resolveModelConnection } from "./config.js";

interface FixtureRule {
  /** Prompt must contain this substring. */
  contains?: string;
  /** Prompt must equal this string exactly. */
  equals?: string;
  respond: string;
}

// Eval fixture seam: when FLYD_MODEL_FIXTURE is set (inline JSON or a path to a
// JSON file), query() returns canned responses instead of calling a provider.
// Rules are evaluated in order; an unmatched prompt throws so regressions fail
// loudly instead of silently passing on the fallback.
let modelFixtureSpec: string | null = null;
let modelFixtureCache: { rules?: FixtureRule[]; fallback?: string } | null | undefined;

function loadModelFixture(): { rules?: FixtureRule[]; fallback?: string } | null {
  const spec = process.env.FLYD_MODEL_FIXTURE;
  if (!spec) return null;
  if (modelFixtureCache === undefined || modelFixtureSpec !== spec) {
    const raw = spec.trimStart().startsWith("{") ? spec : readFileSync(spec, "utf8");
    modelFixtureCache = JSON.parse(raw) as { rules?: FixtureRule[]; fallback?: string };
    modelFixtureSpec = spec;
  }
  return modelFixtureCache;
}

function fixtureResponse(prompt: string): string | null {
  const fixture = loadModelFixture();
  if (!fixture) return null;
  for (const rule of fixture.rules ?? []) {
    const matched =
      rule.equals !== undefined
        ? prompt === rule.equals
        : (rule.contains ?? "") !== "" && prompt.includes(rule.contains ?? "");
    if (matched) return rule.respond;
  }
  if (fixture.fallback !== undefined) return fixture.fallback;
  throw new Error("FLYD_MODEL_FIXTURE active but no rule matched the prompt");
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>;
    required?: string[];
  };
}

export type ToolHandler = (name: string, input: Record<string, unknown>) => string | Promise<string>;

// Coding turns may need extended inspection before their first write, while
// conversational callers can request a smaller, latency-conscious ceiling.
const TOOL_CALL_CEILING = 40;
/** Room for a full plan, draft, or explanation; 2048 truncated long answers mid-thought. */
const AGENT_OUTPUT_TOKENS = 8192;
const TOOL_CEILING_NOTE =
  "\n\nFlyd's tool-call limit for this turn is reached. Answer now from the evidence already gathered. If work is unfinished, say so and name Flyd's tool-call limit as the reason - never an external tool, session, or budget failure.";

export interface QueryOptions {
  json?: boolean;
  /** Base64-encoded JPEG images (no data: prefix) attached to the user message. */
  images?: string[];
}

export function openAICompletionLimit(maxCompletionTokens: number): { max_completion_tokens: number } {
  return { max_completion_tokens: maxCompletionTokens };
}

export function openAIAgentTransport(model: string): "responses" | "chat_completions" {
  return /^gpt-5(?:\.|-|$)/i.test(apiModelId(model)) ? "responses" : "chat_completions";
}

// The OpenCode Go endpoint requires a client user agent and a stable session id
// so it can route and cache prompts. ponytail: one id per process is enough;
// thread the real conversation id through if per-conversation caching matters.
const OPENCODE_HOST = /opencode\.ai/;
const OPENCODE_HEADERS = {
  "User-Agent": "flyd-coding-agent/1.0",
  "x-opencode-session": randomUUID(),
};

function openAIClientOptions(apiKey: string, baseURL?: string) {
  return {
    apiKey,
    baseURL: baseURL || undefined,
    ...(baseURL && OPENCODE_HOST.test(baseURL) ? { defaultHeaders: OPENCODE_HEADERS } : {}),
  };
}

/** Some OpenAI-compatible backends occasionally serialize a function call into text. */
function isSerializedToolProtocol(text: string | null | undefined): boolean {
  return /<(?:\|\||｜｜)DSML(?:\|\||｜｜)\s*(?:calls|invoke)\b/i.test(text ?? "");
}

const SERIALIZED_TOOL_PROTOCOL_RETRY =
  "The previous response was internal tool protocol markup, not user-facing text. Do not render or repeat it. Use the function-call API for a tool, or answer the user directly from the evidence already available.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openAIUserContent(prompt: string, images?: string[]): any {
  if (!images?.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function anthropicUserContent(prompt: string, images?: string[]): any {
  if (!images?.length) return prompt;
  return [
    ...images.map((b64) => ({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: b64 },
    })),
    { type: "text", text: prompt },
  ];
}

export async function query(
  prompt: string,
  model?: string,
  system?: string,
  apiKey?: string,
  baseURL?: string,
  options: QueryOptions = {}
): Promise<string> {
  const fixture = fixtureResponse(prompt);
  if (fixture !== null) return fixture;
  const m = model ?? defaultModel();
  const enriched = await enrichResolutionPromptWithEvidence(prompt, system);
  const resolvedPrompt = enriched.prompt;
  const once = (candidate: string) => usesOpenAITransport(candidate)
    ? queryOpenAI(resolvedPrompt, candidate, system, options)
    : queryAnthropic(resolvedPrompt, candidate, system, options);
  let response: string;
  if (apiKey) {
    response = await queryOpenAIWithConfig(resolvedPrompt, m, system, apiKey, baseURL, options);
  } else if (model && model !== defaultModel()) {
    // A caller that picked a specific non-default model gets exactly that model.
    response = await once(m);
  } else {
    // Default-model callers get the same provider failover as chat.
    response = (await runWithModelFailover([m, ...fallbackModelChain()], once)).result;
  }
  finalizeEvidenceSurface(enriched.surfaceId, response);
  return response;
}

export async function streamQuery(
  prompt: string,
  onToken: (token: string) => void,
  model?: string,
  system?: string,
): Promise<string> {
  const m = model ?? defaultModel();
  return usesOpenAITransport(m)
    ? streamOpenAI(prompt, onToken, m, system)
    : streamAnthropic(prompt, onToken, m, system);
}

export async function agentLoop(
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  model: string,
  maxIterations = TOOL_CALL_CEILING,
  options: AgentLoopOptions = {},
): Promise<string> {
  return usesOpenAITransport(model)
    ? openAIAgentTransport(model) === "responses"
      ? agentLoopOpenAIResponses(system, userMessage, tools, onToolCall, model, maxIterations, options)
      : agentLoopOpenAI(system, userMessage, tools, onToolCall, model, maxIterations, options)
    : agentLoopAnthropic(system, userMessage, tools, onToolCall, model, maxIterations, options);
}

export interface AgentLoopOptions {
  /** Aborts in-flight provider requests; tool calls stop at the next boundary. */
  signal?: AbortSignal;
  /**
   * Epoch ms after which the next model call must answer from the evidence
   * gathered so far. Keeps conversational turns from exploring for minutes.
   */
  answerBy?: number;
  /** Tool calls allowed this turn; once spent, the next model call must answer. */
  toolCallBudget?: number;
  /** Calls that may run concurrently with their siblings (read-only lookups). */
  parallelSafe?(name: string, input: Record<string, unknown>): boolean;
}

interface PendingToolCall {
  name: string;
  input: Record<string, unknown> | null;
  /** Set when the provider sent arguments that are not valid JSON. */
  parseError?: string;
}

function parseToolArguments(name: string, raw: string): PendingToolCall {
  try {
    return { name, input: JSON.parse(raw || "{}") as Record<string, unknown> };
  } catch {
    return { name, input: null, parseError: `Error: invalid JSON arguments for ${name}; resend the call with valid JSON` };
  }
}

/**
 * Run one model turn's tool calls. Independent lookups (several searches, a
 * few file reads) run concurrently; anything that changes state runs in order.
 */
async function runToolBatch(
  calls: PendingToolCall[],
  onToolCall: ToolHandler,
  options: AgentLoopOptions,
): Promise<string[]> {
  const call = abortableToolCall(onToolCall, options.signal);
  const one = (pending: PendingToolCall) =>
    pending.input ? Promise.resolve(call(pending.name, pending.input)) : Promise.resolve(pending.parseError ?? "Error");
  const parallel = calls.length > 1 && options.parallelSafe
    && calls.every((pending) => pending.input && options.parallelSafe!(pending.name, pending.input));
  if (parallel) return Promise.all(calls.map(one));
  const outputs: string[] = [];
  for (const pending of calls) outputs.push(await one(pending));
  return outputs;
}

export interface FailoverOptions extends AgentLoopOptions {
  /** False once the failed attempt did something that must not be repeated. */
  canFailOver?(): boolean;
  onFailover?(event: { from: string; to: string; error: string }): void;
}

function pastAnswerBy(options: AgentLoopOptions, toolCallsUsed = 0): boolean {
  if (options.toolCallBudget !== undefined && toolCallsUsed >= options.toolCallBudget) return true;
  return options.answerBy !== undefined && Date.now() >= options.answerBy;
}

/** A timed-out or cancelled turn must not keep acting after the user was told it stopped. */
function abortableToolCall(onToolCall: ToolHandler, signal?: AbortSignal): ToolHandler {
  return async (name, input) => {
    if (signal?.aborted) {
      const error = new Error("Flyd turn was cancelled");
      error.name = "AbortError";
      throw error;
    }
    return onToolCall(name, input);
  };
}

const PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
const providerCooldowns = new Map<string, number>();

/** Test-only: forget provider cooldowns. */
export function resetProviderCooldowns(): void {
  providerCooldowns.clear();
}

function providerStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "APIUserAbortError";
}

/** Quota, auth, and server faults mean "this provider, not this request". */
function shouldCoolDown(error: unknown): boolean {
  const status = providerStatus(error);
  if (status !== undefined) return status === 429 || status === 401 || status === 403 || status >= 500;
  return /usage limit|rate limit|quota|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|No API key/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Try each model in order, starting with ones not cooling down. A provider that
 * hit a quota/auth/server wall is skipped for a while so later calls do not pay
 * the failed round trip again.
 */
export async function runWithModelFailover<T>(
  models: string[],
  attempt: (model: string) => Promise<T>,
  options: FailoverOptions = {},
): Promise<{ result: T; model: string }> {
  if (models.length === 0) throw new Error("No Flyd model is configured");
  const now = Date.now();
  const healthy = models.filter((model) => (providerCooldowns.get(model) ?? 0) <= now);
  const order = healthy.length > 0 ? [...healthy, ...models.filter((m) => !healthy.includes(m))] : models;
  let lastError: unknown;
  for (let index = 0; index < order.length; index += 1) {
    const model = order[index];
    try {
      const result = await attempt(model);
      providerCooldowns.delete(model);
      return { result, model };
    } catch (error) {
      lastError = error;
      if (isAbort(error, options.signal)) throw error;
      if (shouldCoolDown(error)) providerCooldowns.set(model, Date.now() + PROVIDER_COOLDOWN_MS);
      const next = order[index + 1];
      if (!next || options.canFailOver?.() === false) throw error;
      options.onFailover?.({
        from: model,
        to: next,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError;
}

/** The agent loop on the first healthy model, failing over while nothing unrepeatable happened. */
export async function agentLoopWithFailover(
  models: string[],
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  maxIterations = TOOL_CALL_CEILING,
  options: FailoverOptions = {},
  runLoop: typeof agentLoop = agentLoop,
): Promise<{ answer: string; model: string }> {
  const { result, model } = await runWithModelFailover(
    models,
    (candidate) => runLoop(system, userMessage, tools, onToolCall, candidate, maxIterations, options),
    options,
  );
  return { answer: result, model };
}

export interface ModelProbe {
  model: string;
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Cheapest possible live request, so doctor can show which providers answer right now. */
export async function probeChatModel(model: string, timeoutMs = 15_000): Promise<ModelProbe> {
  const started = Date.now();
  let provider = "unconfigured";
  try {
    const connection = resolveModelConnection(model);
    provider = connection.providerIdentity;
    const signal = AbortSignal.timeout(timeoutMs);
    if (usesOpenAITransport(model)) {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI(openAIClientOptions(connection.apiKey, connection.baseURL));
      await client.chat.completions.create({
        model: apiModelId(model),
        ...openAICompletionLimit(16),
        messages: [{ role: "user", content: "Reply with: ok" }],
      }, { signal });
    } else {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: connection.apiKey, baseURL: connection.baseURL });
      await client.messages.create({
        model: apiModelId(model),
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with: ok" }],
      }, { signal });
    }
    return { model, provider, ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      model,
      provider,
      ok: false,
      latencyMs: Date.now() - started,
      error: (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160),
    };
  }
}

async function queryOpenAIWithConfig(
  prompt: string,
  model: string,
  system: string | undefined,
  apiKey: string,
  baseURL?: string,
  options: QueryOptions = {}
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI(openAIClientOptions(apiKey, baseURL));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: openAIUserContent(prompt, options.images) });
  const limit = options.json ? 8192 : 4096;
  const ask = (maxTokens: number) => client.chat.completions.create({
    model: apiModelId(model),
    ...openAICompletionLimit(maxTokens),
    messages,
    ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
  });
  let res = await ask(limit);
  if (!res.choices.length) throw new Error("OpenAI returned empty choices");
  // Reasoning models can spend the whole budget thinking and return no text;
  // one retry with more room beats silently returning "".
  if (!res.choices[0].message.content?.trim() && res.choices[0].finish_reason === "length") {
    res = await ask(limit * 3);
    if (!res.choices.length) throw new Error("OpenAI returned empty choices");
  }
  const content = res.choices[0].message.content ?? "";
  if (!content.trim() && res.choices[0].finish_reason === "length") {
    throw new Error(`${model} used its whole output budget without answering`);
  }
  return content;
}

async function queryOpenAI(prompt: string, model: string, system?: string, options: QueryOptions = {}): Promise<string> {
  const connection = resolveModelConnection(model);
  return queryOpenAIWithConfig(prompt, model, system, connection.apiKey, connection.baseURL, options);
}

async function queryAnthropic(prompt: string, model: string, system?: string, options: QueryOptions = {}): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const connection = resolveModelConnection(model);
  const client = new Anthropic({ apiKey: connection.apiKey, baseURL: connection.baseURL });
  const res = await client.messages.create({
    model: apiModelId(model),
    max_tokens: options.json ? 8192 : 4096,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: anthropicUserContent(prompt, options.images) }],
  });
  if (!res.content.length) throw new Error("Anthropic returned empty content");
  return res.content[0].type === "text" ? res.content[0].text : "";
}

async function streamOpenAI(
  prompt: string,
  onToken: (token: string) => void,
  model: string,
  system?: string,
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const connection = resolveModelConnection(model);
  const client = new OpenAI(openAIClientOptions(connection.apiKey, connection.baseURL));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const stream = await client.chat.completions.create({
    model: apiModelId(model),
    ...openAICompletionLimit(4096),
    messages,
    stream: true,
  });
  let full = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? "";
    if (!token) continue;
    full += token;
    onToken(token);
  }
  return full;
}

async function streamAnthropic(
  prompt: string,
  onToken: (token: string) => void,
  model: string,
  system?: string,
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const connection = resolveModelConnection(model);
  const client = new Anthropic({ apiKey: connection.apiKey, baseURL: connection.baseURL });
  let full = "";
  const stream = client.messages
    .stream({
      model: apiModelId(model),
      max_tokens: 4096,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: prompt }],
    })
    .on("text", (token) => {
      full += token;
      onToken(token);
    });
  await stream.finalMessage();
  return full;
}

async function agentLoopAnthropic(
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  model: string,
  maxIterations: number,
  options: AgentLoopOptions = {},
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const connection = resolveModelConnection(model);
  const client = new Anthropic({ apiKey: connection.apiKey, baseURL: connection.baseURL });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: userMessage }];

  const ceiling = Math.min(TOOL_CALL_CEILING, Math.max(1, maxIterations));
  let toolCallsUsed = 0;
  for (let i = 0; i < ceiling; i++) {
    // Last call drops tools so the model must answer with what it gathered
    // instead of the loop discarding everything at budget exhaustion.
    const lastCall = i === ceiling - 1 || pastAnswerBy(options, toolCallsUsed);
    const res = await client.messages.create({
      model: apiModelId(model),
      max_tokens: AGENT_OUTPUT_TOKENS,
      temperature: 0.2,
      system: lastCall ? `${system}${TOOL_CEILING_NOTE}` : system,
      ...(lastCall ? {} : {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      }),
      messages,
    }, { signal: options.signal });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resContent = res.content as any[];
    messages.push({ role: "assistant", content: resContent });

    if (res.stop_reason === "end_turn") {
      const text = resContent.find((b) => b.type === "text");
      return text ? (text.text as string) : "";
    }

    if (res.stop_reason === "tool_use") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = res.content as any[];
      const results: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      const uses = blocks.filter((b) => b.type === "tool_use");
      const outputs = await runToolBatch(
        uses.map((b) => ({ name: b.name as string, input: (b.input ?? {}) as Record<string, unknown> })),
        onToolCall,
        options,
      );
      toolCallsUsed += outputs.length;
      uses.forEach((b, index) => {
        results.push({
          type: "tool_result" as const,
          tool_use_id: b.id as string,
          content: outputs[index],
        });
      });
      messages.push({ role: "user", content: results });
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallbackText = (res.content as any[]).find((b) => b.type === "text");
    return fallbackText ? (fallbackText.text as string) : "";
  }

  throw new Error("agentLoop: exceeded max iterations");
}

async function agentLoopOpenAI(
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  model: string,
  maxIterations: number,
  options: AgentLoopOptions = {},
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const connection = resolveModelConnection(model);
  const client = new OpenAI(openAIClientOptions(connection.apiKey, connection.baseURL));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];

  const oaiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const ceiling = Math.min(TOOL_CALL_CEILING, Math.max(1, maxIterations));
  let toolCallsUsed = 0;
  for (let i = 0; i < ceiling; i++) {
    const lastCall = i === ceiling - 1 || pastAnswerBy(options, toolCallsUsed);
    // History holds tool calls, so the final request keeps the tool list (some
    // backends reject tool history without it) but forbids further calls.
    if (lastCall) messages.push({ role: "user", content: TOOL_CEILING_NOTE.trim() });
    const res = await client.chat.completions.create({
      model: apiModelId(model),
      ...openAICompletionLimit(AGENT_OUTPUT_TOKENS),
      tools: oaiTools,
      ...(lastCall ? { tool_choice: "none" as const } : {}),
      messages,
    }, { signal: options.signal });

    const choice = res.choices[0];
    messages.push(choice.message);

    if (choice.finish_reason === "stop") {
      if (isSerializedToolProtocol(choice.message.content)) {
        messages.push({ role: "user", content: SERIALIZED_TOOL_PROTOCOL_RETRY });
        continue;
      }
      return choice.message.content ?? "";
    }

    if (lastCall) {
      // tool_choice "none" is advisory on some backends; never discard the turn.
      return choice.message.content?.trim()
        || "I reached Flyd's tool-call limit before I could finish this answer. Ask me to continue and I'll pick up from here.";
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolCalls = choice.message.tool_calls;
      const outputs = await runToolBatch(
        toolCalls.map((tc) => parseToolArguments(tc.function.name, tc.function.arguments)),
        onToolCall,
        options,
      );
      toolCallsUsed += outputs.length;
      toolCalls.forEach((tc, index) => {
        messages.push({ role: "tool", tool_call_id: tc.id, content: outputs[index] });
      });
      continue;
    }

    return choice.message.content ?? "";
  }

  throw new Error("agentLoop: exceeded max iterations");
}

async function agentLoopOpenAIResponses(
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  model: string,
  maxIterations: number,
  options: AgentLoopOptions = {},
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const connection = resolveModelConnection(model);
  const client = new OpenAI(openAIClientOptions(connection.apiKey, connection.baseURL));
  // Response output items are valid subsequent input items. Keeping them in the
  // local loop preserves reasoning and tool-call context without server-side session state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any[] = [{ role: "user", content: userMessage }];
  const responseTools = tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: false,
  }));

  const ceiling = Math.min(TOOL_CALL_CEILING, Math.max(1, maxIterations));
  let toolCallsUsed = 0;
  for (let iteration = 0; iteration < ceiling; iteration += 1) {
    const lastCall = iteration === ceiling - 1 || pastAnswerBy(options, toolCallsUsed);
    const response = await client.responses.create({
      model: apiModelId(model),
      instructions: lastCall ? `${system}${TOOL_CEILING_NOTE}` : system,
      input,
      ...(lastCall ? {} : { tools: responseTools }),
      max_output_tokens: AGENT_OUTPUT_TOKENS,
    }, { signal: options.signal });
    if (response.error) throw new Error(`OpenAI Responses API: ${response.error.message}`);
    input.push(...response.output);
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) return response.output_text ?? "";

    const outputs = await runToolBatch(
      calls.map((call) => parseToolArguments(call.name, call.arguments)),
      onToolCall,
      options,
    );
      toolCallsUsed += outputs.length;
    calls.forEach((call, index) => {
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: outputs[index],
      });
    });
  }

  throw new Error("agentLoop: exceeded max iterations");
}
