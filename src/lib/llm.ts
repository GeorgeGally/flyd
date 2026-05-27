import { isOpenAIModel, defaultModel, getKey } from "./config.js";

export async function query(prompt: string, model?: string): Promise<string> {
  const m = model ?? defaultModel();
  return isOpenAIModel(m) ? queryOpenAI(prompt, m) : queryAnthropic(prompt, m);
}

async function queryOpenAI(prompt: string, model: string): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: getKey("OPENAI_API_KEY") });
  const res = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0].message.content ?? "";
}

async function queryAnthropic(prompt: string, model: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: getKey("ANTHROPIC_API_KEY") });
  const res = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content[0].type === "text" ? res.content[0].text : "";
}
