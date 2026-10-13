/** Request projection only: transcripts and canonical evidence remain verbatim. */
export interface ToolHistoryPolicy {
  /** Estimated input budget, not a claim about a provider's actual window. */
  inputBudget?: number;
  overhead?: string;
}

export interface ToolHistoryStats {
  before: number;
  after: number;
  elided: number;
  pressureRemaining: boolean;
}

// Deliberately an estimate, not a tokenizer or an overflow guarantee. UTF-8
// bytes account for non-Latin text better than JS string length alone.
const estimate = (value: unknown): number => Math.ceil(Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") / 3);
const RESPONSE_OUTPUT = new Set(["reasoning", "message", "function_call"]);
function stub(text: string): string {
  // A scan can have several findings and exceed the normal head excerpt.
  // Preserve its complete notice and handling instruction, compressing only
  // the fetched body. Malformed notices stay intact rather than losing context.
  let prefix = "";
  let body = text;
  if (text.startsWith("⚠ SECURITY NOTICE (Flyd scan of ")) {
    const marker = "\n--- fetched content follows ---\n";
    const end = text.indexOf(marker);
    if (end < 0) return text;
    prefix = text.slice(0, end + marker.length);
    body = text.slice(prefix.length);
  }
  const shortened = `${prefix}${body.slice(0, 512)}\n[Older tool output elided from this request (${text.length} characters). Re-read the source if exact details are needed.]\n${body.slice(-512)}`;
  return shortened.length < text.length ? shortened : text;
}

/** Supports Chat Completions, Anthropic tool_result, and Responses items.
 * Only observation bodies change; call IDs, calls, reasoning, user instructions,
 * and the newest two model turns survive intact. No extra LLM or recall tool.
 */
export function elideToolHistory<T extends Record<string, unknown>>(
  messages: T[], policy: ToolHistoryPolicy = {}, enabled = true,
  report?: (stats: ToolHistoryStats) => void,
): { messages: T[]; stats: ToolHistoryStats } {
  const budget = Number.isFinite(policy.inputBudget) && policy.inputBudget! > 0
    ? policy.inputBudget! : 32_768;
  const overhead = estimate(policy.overhead ?? "");
  const before = estimate(messages) + overhead;
  const stats: ToolHistoryStats = { before, after: before, elided: 0, pressureRemaining: before >= budget * 0.85 };
  if (!enabled || before < budget * 0.6) return { messages, stats };

  // Protect both two complete assistant turns and 30% of the input budget.
  let turns = 0;
  let recent = 0;
  let boundary = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    recent += estimate(messages[i]);
    const item = messages[i];
    const previous = messages[i - 1];
    const startsTurn = RESPONSE_OUTPUT.has(String(item.type))
      ? !RESPONSE_OUTPUT.has(String(previous?.type))
      : item.role === "assistant";
    if (startsTurn) turns++;
    boundary = i;
    if (turns >= 2 && recent >= budget * 0.3) break;
  }

  const projected = messages.map((message, index) => {
    if (index >= boundary) return message;
    const shorten = (text: unknown): unknown => {
      if (typeof text !== "string" || text.length < 4096) return text;
      const shortened = stub(text);
      if (shortened === text) return text;
      stats.elided++;
      return shortened;
    };
    if (message.role === "tool") return { ...message, content: shorten(message.content) } as T;
    if (message.type === "function_call_output") return { ...message, output: shorten(message.output) } as T;
    if (message.role === "user" && Array.isArray(message.content)) {
      return { ...message, content: message.content.map((block: Record<string, unknown>) =>
        block.type === "tool_result" ? { ...block, content: shorten(block.content) } : block) } as T;
    }
    return message;
  });
  stats.after = estimate(projected) + overhead;
  stats.pressureRemaining = stats.after >= budget * 0.85;
  report?.(stats);
  return { messages: projected, stats };
}
