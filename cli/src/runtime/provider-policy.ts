/**
 * Which providers Flyd may send work to (George's rule, 2026-11-15):
 *
 * - Claude does all text, code, review and chat work.
 * - His ChatGPT/Codex allowance is for images only. The Codex CLI and an OpenCode run on
 *   OpenCode's ChatGPT ("openai/…") login both spend it.
 * - OpenCode, OpenCode Go and DeepSeek are never used, not even as a fallback: their
 *   accounts ran dry and every silent retry on them billed George a 402.
 *
 * Flyd's own "openai:…" models go through the separately billed OPENAI_API_KEY, not the
 * ChatGPT allowance, so this rule leaves them alone.
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

/** OpenCode, OpenCode Go or DeepSeek, by provider prefix or by model name, through any route. */
export function isRetiredProvider(target: string | undefined): boolean {
  const name = (target ?? "").trim().toLowerCase();
  return name === "opencode" || name === "opencode-go" || /^opencode(?:-go)?[:/]/.test(name) || name.includes("deepseek");
}

/** A model or worker Flyd may use for text, code, review or chat work. */
export function allowedForText(target: string | undefined): boolean {
  return !isRetiredProvider(target) && !spendsChatGptAllowance(target);
}

/** Throws before text, code, review or chat work goes anywhere but an allowed provider. */
export function refuseForText(target: string | undefined, work: string): void {
  refuseChatGptAllowance(target, work);
  if (isRetiredProvider(target)) throw new Error(`${target} is OpenCode or DeepSeek, which Flyd no longer uses; ${work} runs on Claude`);
}
