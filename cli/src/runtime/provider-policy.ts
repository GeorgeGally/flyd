import { isBanned, isImagesOnly } from "./model-routing.js";

/**
 * Which providers Flyd may send work to. The lists live in the model-routing config
 * (runtime/model-routing.ts, ~/.flyd/models.json), so these checks follow it:
 *
 * - `banned` providers (default OpenCode, OpenCode Go and DeepSeek) are never used, not
 *   even as a fallback: their accounts ran dry and every silent retry billed George a 402.
 * - `imagesOnly` providers (default Codex, George's ChatGPT/Codex allowance) do images
 *   only. An OpenCode-style "openai/…" id is that allowance's ChatGPT login too.
 *
 * Flyd's own "openai:…" models go through the separately billed OPENAI_API_KEY, not the
 * ChatGPT allowance, so this rule leaves them alone.
 */
export function spendsChatGptAllowance(target: string | undefined): boolean {
  return isImagesOnly(target) || (target ?? "").trim().toLowerCase().startsWith("openai/");
}

/** Throws before any text, code, review or chat work is sent to the ChatGPT/Codex allowance. */
export function refuseChatGptAllowance(target: string | undefined, work: string): void {
  if (!spendsChatGptAllowance(target)) return;
  throw new Error(`${target} runs on George's ChatGPT/Codex allowance, which is kept for images only; ${work} runs on Claude`);
}

/** A provider the model-routing config bans, by provider prefix or by model name, through any route. */
export function isRetiredProvider(target: string | undefined): boolean {
  return isBanned(target);
}

/** A model or worker Flyd may use for text, code, review or chat work. */
export function allowedForText(target: string | undefined): boolean {
  return !isRetiredProvider(target) && !spendsChatGptAllowance(target);
}

/** Throws before text, code, review or chat work goes anywhere but an allowed provider. */
export function refuseForText(target: string | undefined, work: string): void {
  refuseChatGptAllowance(target, work);
  if (isRetiredProvider(target)) throw new Error(`${target} is a provider Flyd no longer uses (banned in its model config); ${work} runs on Claude`);
}
