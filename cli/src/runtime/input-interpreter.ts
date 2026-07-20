export type AgentInput =
  | { kind: "conversation"; message: string }
  | { kind: "coding"; outcome: string }
  | { kind: "resume" }
  | { kind: "exit" };

const ACTION_OPENING = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:fix|implement|build|add|remove|delete|refactor|update|change|debug|test|ship|wire|migrate|rename|replace|restore|revert|clean up|investigate|review)\b/i;
const CODE_SIGNAL = /\b(?:api|app|backend|branch|broken|bug|chat|class|cli|cmd\+enter|code|commit|controller|css|database|debugger|deploy|failing|file|frontend|function|github|html|implementation|javascript|method|migration|model|npm|patch|pr|prd|pull request|rails|repo|repository|route|ruby|runtime|schema|spec|test|typescript|view|website|worker)\b/i;

export function interpretAgentInput(input: string): AgentInput {
  const text = input.trim();
  const normalized = text.toLowerCase();

  if ([ "/exit", "/quit", "exit", "quit" ].includes(normalized)) return { kind: "exit" };
  if (normalized === "/resume") return { kind: "resume" };
  if (normalized.startsWith("/code ")) {
    return { kind: "coding", outcome: text.slice("/code ".length).trim() };
  }

  if (ACTION_OPENING.test(text) && CODE_SIGNAL.test(text)) {
    return { kind: "coding", outcome: text };
  }

  return { kind: "conversation", message: text };
}
