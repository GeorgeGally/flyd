/**
 * George's ChatGPT/Codex allowance is for images only (his rule, 2026-11-15). Text, code,
 * review and chat work runs on Claude, or on a plan that is not the ChatGPT login.
 *
 * Two things spend that allowance: the Codex CLI, and an OpenCode run on OpenCode's
 * ChatGPT login (an "openai/…" model, which is also OpenCode's own default here, so an
 * OpenCode run with no model named spends it too). Flyd's own "openai:…" models go
 * through the separately billed OPENAI_API_KEY and are not this allowance.
 */
export function spendsChatGptAllowance(target: string | undefined): boolean {
  const name = (target ?? "").trim().toLowerCase();
  return name === "codex" || name.startsWith("codex/") || name.startsWith("openai/");
}

/** Throws before any text, code, review or chat work is sent to the ChatGPT/Codex allowance. */
export function refuseChatGptAllowance(target: string | undefined, work: string): void {
  if (!spendsChatGptAllowance(target)) return;
  throw new Error(`${target} runs on George's ChatGPT/Codex allowance, which is kept for images only; ${work} runs on Claude`);
}
