/**
 * Where George is writing from in Flyd's window: one project's conversation,
 * or Flyd's general chat (no project). The message box shows it and he can
 * change it in a click; a message that clearly names another project is
 * scoped to that one. General is the default, so earlier talk about a project
 * never makes a new message about it.
 */
export interface ChatScope {
  /** The project's name as George uses it; absent in the general chat. */
  project?: string;
}

/** The line Flyd's turn reads, so a general message is never taken as a project's. */
export function chatScopeLine(scope: ChatScope | undefined): string {
  if (!scope) return "";
  return scope.project
    ? `Where he is writing: the "${scope.project}" conversation. This message is about ${scope.project} unless his words name another project.\n`
    : "Where he is writing: Flyd's general chat, not any project's. Earlier messages about a project do not make this one about it: it is about a project only when his words name one.\n";
}
