import { readFileSync } from "node:fs";
import { finalizeEvidenceSurface } from "../evidence/compose-surface.js";
import { enrichResolutionPromptWithEvidence } from "../evidence/resolution-evidence.js";
import { isOpenAIModel, defaultModel, resolveModelConnection } from "./config.js";

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
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export type ToolHandler = (name: string, input: Record<string, unknown>) => string | Promise<string>;

export interface QueryOptions {
  json?: boolean;
  /** Base64-encoded JPEG images (no data: prefix) attached to the user message. */
  images?: string[];
}

export function openAICompletionLimit(maxCompletionTokens: number): { max_completion_tokens: number } {
  return { max_completion_tokens: maxCompletionTokens };
}

export function openAIAgentTransport(model: string): "responses" | "chat_completions" {
  return /^gpt-5(?:\.|-|$)/i.test(model) ? "responses" : "chat_completions";
}

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
  let response: string;
  if (apiKey) {
    response = await queryOpenAIWithConfig(resolvedPrompt, m, system, apiKey, baseURL, options);
  } else {
    response = isOpenAIModel(m)
      ? await queryOpenAI(resolvedPrompt, m, system, options)
      : await queryAnthropic(resolvedPrompt, m, system, options);
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
  return isOpenAIModel(m)
    ? streamOpenAI(prompt, onToken, m, system)
    : streamAnthropic(prompt, onToken, m, system);
}

export async function agentLoop(
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  model: string,
  maxIterations = 8,
): Promise<string> {
  return isOpenAIModel(model)
    ? openAIAgentTransport(model) === "responses"
      ? agentLoopOpenAIResponses(system, userMessage, tools, onToolCall, model, maxIterations)
      : agentLoopOpenAI(system, userMessage, tools, onToolCall, model, maxIterations)
    : agentLoopAnthropic(system, userMessage, tools, onToolCall, model, maxIterations);
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
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: openAIUserContent(prompt, options.images) });
  const res = await client.chat.completions.create({
    model,
    ...openAICompletionLimit(options.json ? 4096 : 2048),
    temperature: 0.2,
    messages,
    ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
  });
  if (!res.choices.length) throw new Error("OpenAI returned empty choices");
  return res.choices[0].message.content ?? "";
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
    model,
    max_tokens: options.json ? 4096 : 2048,
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
  const client = new OpenAI({ apiKey: connection.apiKey, baseURL: connection.baseURL });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const stream = await client.chat.completions.create({
    model,
    ...openAICompletionLimit(2048),
    temperature: 0.2,
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
      model,
      max_tokens: 2048,
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

// ponytail: a plain conversation turn budgets 8 iterations, but a self-repair
// turn that starts editing files must be able to finish the edit; a successful
// write extends the ceiling to WRITE_TOOL_CEILING, per-account ceilings if needed.
const WRITE_TOOL_CEILING = 40;
const WRITE_TOOLS = new Set(["edit_file", "write_file"]);
const WRITE_FAILURE_PREFIX = /^(?:Error |Access denied|File not found)/;

function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

function isFailedWrite(content: string): boolean {
  return WRITE_FAILURE_PREFIX.test(content);
}

async function agentLoopAnthropic(
  system: string,
  userMessage: string,
  tools: AgentTool[],
  onToolCall: ToolHandler,
  model: string,
  maxIterations: number,
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const connection = resolveModelConnection(model);
  const client = new Anthropic({ apiKey: connection.apiKey, baseURL: connection.baseURL });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: userMessage }];

  let editing = false;
  for (let i = 0; i < (editing ? WRITE_TOOL_CEILING : maxIterations); i++) {
    // Last call drops tools so the model must answer with what it gathered
    // instead of the loop discarding everything at budget exhaustion.
    const lastCall = i === (editing ? WRITE_TOOL_CEILING : maxIterations) - 1;
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0.2,
      system: lastCall
        ? `${system}\n\nTool budget is exhausted. Answer now from the evidence gathered so far; state plainly what you could not finish.`
        : system,
      ...(lastCall ? {} : {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      }),
      messages,
    });

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
      const results = [];
      for (const b of blocks) {
        if (b.type !== "tool_use") continue;
        const content = await onToolCall(b.name as string, b.input as Record<string, unknown>);
        if (isWriteTool(b.name) && !isFailedWrite(content)) editing = true;
        results.push({
          type: "tool_result" as const,
          tool_use_id: b.id as string,
          content,
        });
      }
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
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const connection = resolveModelConnection(model);
  const client = new OpenAI({ apiKey: connection.apiKey, baseURL: connection.baseURL });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];

  const oaiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  let editing = false;
  for (let i = 0; i < (editing ? WRITE_TOOL_CEILING : maxIterations); i++) {
    const lastCall = i === (editing ? WRITE_TOOL_CEILING : maxIterations) - 1;
    const res = await client.chat.completions.create({
      model,
      ...openAICompletionLimit(2048),
      temperature: 0.2,
      ...(lastCall ? {} : { tools: oaiTools }),
      messages,
    });

    const choice = res.choices[0];
    messages.push(choice.message);

    if (choice.finish_reason === "stop") return choice.message.content ?? "";

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        const content = await onToolCall(tc.function.name, input);
        if (isWriteTool(tc.function.name) && !isFailedWrite(content)) editing = true;
        messages.push({ role: "tool", tool_call_id: tc.id, content });
      }
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
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const connection = resolveModelConnection(model);
  const client = new OpenAI({ apiKey: connection.apiKey, baseURL: connection.baseURL });
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

  let editing = false;
  for (let iteration = 0; iteration < (editing ? WRITE_TOOL_CEILING : maxIterations); iteration += 1) {
    const lastCall = iteration === (editing ? WRITE_TOOL_CEILING : maxIterations) - 1;
    const response = await client.responses.create({
      model,
      instructions: lastCall
        ? `${system}\n\nTool budget is exhausted. Answer now from the evidence gathered so far; state plainly what you could not finish.`
        : system,
      input,
      ...(lastCall ? {} : { tools: responseTools }),
      max_output_tokens: 2048,
    });
    if (response.error) throw new Error(`OpenAI Responses API: ${response.error.message}`);
    input.push(...response.output);
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) return response.output_text ?? "";

    for (const call of calls) {
      let parameters: Record<string, unknown> = {};
      try {
        parameters = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        throw new Error(`Invalid tool arguments for ${call.name}`);
      }
      const output = await onToolCall(call.name, parameters);
      if (isWriteTool(call.name) && !isFailedWrite(output)) editing = true;
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
  }

  throw new Error("agentLoop: exceeded max iterations");
}
