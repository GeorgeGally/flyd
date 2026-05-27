import { hasApiKey, defaultModel } from "../lib/config.js";
import { keywordSearch, buildQueryPrompt } from "../lib/knowledge.js";
import { query } from "../lib/llm.js";

export async function runAsk(question: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();
  const context = keywordSearch(question);

  if (!context) {
    console.log("no governed context");
    return;
  }

  if (!hasApiKey(m)) {
    console.log("Knowledge wiki answer (keyword match):\n");
    console.log(context);
    return;
  }

  const prompt = buildQueryPrompt(question, context);
  const answer = await query(prompt, m);
  console.log(answer);
}
