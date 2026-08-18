import { finalizeEvidenceSurface } from "../evidence/compose-surface.js";
import { enrichResolutionPromptWithEvidence } from "../evidence/resolution-evidence.js";
import { isOpenAIModel, defaultModel, resolveModelConnection } from "./config.js";

export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export type ToolHandler = (name: string, input: Record<string, unknown>) => string;

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

  for (let i = 0; i < maxIterations; i++) {
    // Last call drops tools so the model must answer with what it gathered
    // instead of the loop discarding everything at budget exhaustion.
    const lastCall = i === maxIterations - 1;
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
      const results = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          type: "tool_result" as const,
          tool_use_id: b.id as string,
          content: onToolCall(b.name as string, b.input as Record<string, unknown>),
        }));
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

  for (let i = 0; i < maxIterations; i++) {
    const lastCall = i === maxIterations - 1;
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
        messages.push({ role: "tool", tool_call_id: tc.id, content: onToolCall(tc.function.name, input) });
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

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const lastCall = iteration === maxIterations - 1;
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
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: onToolCall(call.name, parameters),
      });
    }
  }

  throw new Error("agentLoop: exceeded max iterations");
}
