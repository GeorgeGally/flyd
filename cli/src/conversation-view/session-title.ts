/** Repository labels belong to project metadata, not conversation titles. */
export function isRepositoryStatusTitle(value: string): boolean {
  const title = value.trim();
  return /^(?:main|master|develop|development|dev|trunk|head|detached|(?:feature|feat|fix|bugfix|hotfix|chore|release|codex|fm|work|task|wip)[/-][\w./-]+)$/i.test(title)
    || /^(?:[\w.-]+(?:\/[\w.-]+)*)\s+(?:\?\d+|[?*+↑↓][\w?*+↑↓-]*|[MADRCU]{1,2})$/i.test(title)
    || /^(?:[\w.-]+\/)+[\w./-]+$/.test(title);
}

export function shortConversationTitle(text: string): string {
  const title = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return title && !isRepositoryStatusTitle(title) ? title : "Untitled conversation";
}
