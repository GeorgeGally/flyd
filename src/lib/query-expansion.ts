import { isOpenAIModel, defaultModel, getKey } from "./config.js";

export interface ExpandedQuery {
  type: "lex" | "vec" | "hyde";
  query: string;
}

const EXPANSION_PROMPT = `You are a search query expansion engine. Given a user's question, generate 3 search-optimized variants:

1. A keyword-focused version (for exact word matching)
2. A semantic/paraphrased version (for meaning-based matching)
3. A hypothetical answer/document (what a relevant document might say)

Return EXACTLY 3 lines in this format:
lex: <keyword query>
vec: <semantic query>
hyde: <hypothetical document text>

Keep each under 100 words. Be specific and include key concepts.

User question: "{query}"`;

async function queryOpenAI(prompt: string, model: string): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: getKey("OPENAI_API_KEY") });
  const res = await client.chat.completions.create({
    model,
    max_tokens: 400,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });
  if (!res.choices.length) throw new Error("OpenAI returned empty choices");
  return res.choices[0].message.content ?? "";
}

export async function expandQuery(
  query: string,
  model?: string,
): Promise<ExpandedQuery[]> {
  const apiKey = getKey("OPENAI_API_KEY");
  if (!apiKey) {
    // No API key — return original query as fallback
    return [
      { type: "lex", query },
      { type: "vec", query },
    ];
  }

  try {
    const prompt = EXPANSION_PROMPT.replace("{query}", query);
    const m = model ?? defaultModel();
    const result = isOpenAIModel(m)
      ? await queryOpenAI(prompt, m)
      : await queryOpenAI(prompt, "gpt-4o-mini");

    const lines = result.trim().split("\n");
    const expanded: ExpandedQuery[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const type = line.slice(0, colonIdx).trim() as "lex" | "vec" | "hyde";
      if (type !== "lex" && type !== "vec" && type !== "hyde") continue;

      const text = line.slice(colonIdx + 1).trim();
      if (!text) continue;

      // Ensure expanded query contains at least one original query term
      const textLower = text.toLowerCase();
      const hasOriginalTerm = queryTerms.some((term) => textLower.includes(term));
      if (!hasOriginalTerm) continue;

      expanded.push({ type, query: text });
    }

    // Always include original query as fallback
    const hasOriginal = expanded.some((e) => e.query === query);
    if (!hasOriginal) {
      expanded.push({ type: "lex", query });
    }

    return expanded.length > 0 ? expanded : [{ type: "lex", query }];
  } catch (err) {
    console.error("query expansion failed:", err instanceof Error ? err.message : String(err));
    return [{ type: "lex", query }];
  }
}
