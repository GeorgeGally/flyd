export type AgentInput =
  | { kind: "conversation"; message: string }
  | { kind: "coding"; outcome: string }
  | { kind: "contextual_action"; message: string }
  | { kind: "continue"; message: string }
  | { kind: "resume" }
  | { kind: "exit" };

/** Above this, auto-routing to coding is too easy to trip via paste. Use /code. */
export const MAX_AUTO_CODING_OUTCOME_CHARS = 4_000;

const ACTION_OPENING = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:fix|implement|build|add|remove|delete|refactor|update|change|debug|test|ship|wire|migrate|rename|replace|restore|revert|clean up|investigate|review|improve|modify|rewrite)\b/i;
const UNAMBIGUOUS_CODE_ACTION = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:implement|refactor|debug|ship|wire|migrate|restore|revert)\b/i;
const INSPECT_THEN_ACTION = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:take a look at|look at|check out|inspect|review)\b[\s\S]*?\b(?:and|then)\s+(?:implement|integrate|install|add|adapt|port|wire|fix|build|apply)\b/i;
// Questions and look-arounds ("what's the status of the project", "look at
// cleanx and tell me what's left") are answered in chat, which has read tools.
// Only requests to change something hand off to the supervised coding runtime.
const QUESTION_OPENING = /^(?:so\s+|and\s+|ok(?:ay)?[,\s]+)?(?:how|why|what(?:'s|s)?|when|where|who|which|is|are|does|do|did|has|have|was|were)\b/i;
const CODE_SIGNAL = /\b(?:api|app|backend|branch|broken|bug|chat|class|cli|cmd\+enter|code|codebase|commit|controller|css|database|debugger|deploy|failing|file|flyd|frontend|function|github|html|implementation|integration|javascript|library|method|migration|model|npm|package|patch|plugin|pr|prd|pull request|rails|repo|repository|route|ruby|runtime|schema|skill|source|spec|structure|test|typescript|view|website|worker)\b/i;
const NATURAL_CONTINUATION = /^(?:continue|conrtinue|carry on|keep going)(?:\s+(?:with\s+)?(?:that|it|this))?[.!]?$/i;
const CONTEXTUAL_ACTION = /^(?:(?:ok|okay|yes|right|fine)[,.!]?\s+)?(?:(?:no[,.!]?\s+)?(?:you\s+)?)?(?:implement(?:\s+(?:it|that|this))?|do it|go ahead|make it happen|build it|fix it)(?:\s+(?:then|now))?[.!]*$/i;

export function interpretAgentInput(input: string): AgentInput {
  const text = input.trim();
  const normalized = text.toLowerCase();

  if ([ "/exit", "/quit", "exit", "quit" ].includes(normalized)) return { kind: "exit" };
  if (normalized === "/resume") return { kind: "resume" };
  if (NATURAL_CONTINUATION.test(text)) return { kind: "continue", message: text };
  if (CONTEXTUAL_ACTION.test(text)) return { kind: "contextual_action", message: text };
  if (normalized.startsWith("/code ")) {
    return { kind: "coding", outcome: text.slice("/code ".length).trim() };
  }

  // Long pastes often contain code-ish words and used to hijack into the
  // coding harness, then crash on "Correction is too long". Keep them in chat.
  if (text.length > MAX_AUTO_CODING_OUTCOME_CHARS) {
    return { kind: "conversation", message: text };
  }

  if (QUESTION_OPENING.test(text)) return { kind: "conversation", message: text };

  if (UNAMBIGUOUS_CODE_ACTION.test(text) ||
      (ACTION_OPENING.test(text) && CODE_SIGNAL.test(text.replace(ACTION_OPENING, ""))) ||
      (INSPECT_THEN_ACTION.test(text) && CODE_SIGNAL.test(text))) {
    return { kind: "coding", outcome: text };
  }

  return { kind: "conversation", message: text };
}
