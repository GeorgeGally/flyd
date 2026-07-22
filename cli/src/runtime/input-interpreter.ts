export type AgentInput =
  | { kind: "conversation"; message: string }
  | { kind: "coding"; outcome: string }
  | { kind: "contextual_action"; message: string }
  | { kind: "continue"; message: string }
  | { kind: "resume" }
  | { kind: "exit" };

const ACTION_OPENING = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:fix|implement|build|add|remove|delete|refactor|update|change|debug|test|ship|wire|migrate|rename|replace|restore|revert|clean up|investigate|review|explore|check|examine|audit|survey|assess|evaluate|analyze|study|search|scan|improve|modify|rewrite|show me)\b/i;
const UNAMBIGUOUS_CODE_ACTION = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:implement|refactor|debug|test|ship|wire|migrate|restore|revert)\b/i;
const INSPECT_THEN_ACTION = /^(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)?(?:take a look at|look at|check out|inspect|review)\b[\s\S]*?\b(?:and|then)\s+(?:implement|integrate|install|add|adapt|port|wire|fix|build|apply)\b/i;
const CODEBASE_EXPLORATION = /\b(?:take a look at|look at|check out|inspect|review|explore|examine|audit|survey|assess|evaluate|tell me about|walk me through|familiarize|look into|dive into|study|analyze|show me|how far|how much|what is the status|what's the status|where are we|how are we|take a look|check on|look around|get a sense|get an overview|what's going on|what is going on|how does this|see what|see how)\b[\s\S]*?\b(?:codebase|code|repo|repository|project|source|architecture|structure|directory|setup|layout|module|component|package|gem|dependency|framework|language|config|environment|env|workflow|pipeline)\b/i;
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

  if (UNAMBIGUOUS_CODE_ACTION.test(text) ||
      ((ACTION_OPENING.test(text) || INSPECT_THEN_ACTION.test(text)) && CODE_SIGNAL.test(text)) ||
      CODEBASE_EXPLORATION.test(text)) {
    return { kind: "coding", outcome: text };
  }

  return { kind: "conversation", message: text };
}
