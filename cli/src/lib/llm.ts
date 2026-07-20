import { isOpenAIModel, defaultModel, getKey } from "./config.js";

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

export async function query(prompt: string, model?: string, system?: string): Promise<string> {
  const m = model ?? defaultModel();
  return isOpenAIModel(m) ? queryOpenAI(prompt, m, system) : queryAnthropic(prompt, m, system);
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
    ? agentLoopOpenAI(system, userMessage, tools, onToolCall, model, maxIterations)
    : agentLoopAnthropic(system, userMessage, tools, onToolCall, model, maxIterations);
}

async function queryOpenAI(prompt: string, model: string, system?: string): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: getKey("OPENAI_API_KEY") });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const res = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    temperature: 0.2,
    messages,
  });
  if (!res.choices.length) throw new Error("OpenAI returned empty choices");
  return res.choices[0].message.content ?? "";
}

async function queryAnthropic(prompt: string, model: string, system?: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: getKey("ANTHROPIC_API_KEY") });
  const res = await client.messages.create({
    model,
    max_tokens: 2048,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: prompt }],
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
  const client = new OpenAI({ apiKey: getKey("OPENAI_API_KEY") });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const stream = await client.chat.completions.create({
    model,
    max_tokens: 2048,
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
  const client = new Anthropic({ apiKey: getKey("ANTHROPIC_API_KEY") });
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
  const client = new Anthropic({ apiKey: getKey("ANTHROPIC_API_KEY") });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: userMessage }];

  for (let i = 0; i < maxIterations; i++) {
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0.2,
      system,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
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
  const client = new OpenAI({ apiKey: getKey("OPENAI_API_KEY") });

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
    const res = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      temperature: 0.2,
      tools: oaiTools,
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
