export type AgentInput =
  | { kind: "conversation"; message: string }
  | { kind: "coding"; outcome: string }
  | { kind: "resume" }
  | { kind: "exit" };

/**
 * Only explicit session controls are interpreted here. Everything else is a
 * conversation turn: the model decides whether a message is a question, a
 * small edit it can make itself, or a job for the supervised coding runtime
 * (start_coding_task). Phrase-matching regexes used to make that call and
 * hijacked questions like "what's the status of the project".
 */
export function interpretAgentInput(input: string): AgentInput {
  const text = input.trim();
  const normalized = text.toLowerCase();

  if ([ "/exit", "/quit", "exit", "quit" ].includes(normalized)) return { kind: "exit" };
  if (normalized === "/resume") return { kind: "resume" };
  if (normalized.startsWith("/code ")) {
    return { kind: "coding", outcome: text.slice("/code ".length).trim() };
  }
  return { kind: "conversation", message: text };
}
