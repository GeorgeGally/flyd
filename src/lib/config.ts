import { homedir } from "os";
import { existsSync } from "fs";
import { join } from "path";

export const FLYD_DIR = join(homedir(), ".flyd");
export const RAW_DIR = join(FLYD_DIR, "raw");
export const KNOWLEDGE_DIR = join(FLYD_DIR, "knowledge");

export function shellRcPath(): string {
  const zshrc = join(homedir(), ".zshrc");
  const bashrc = join(homedir(), ".bashrc");
  return existsSync(zshrc) ? zshrc : bashrc;
}

export function defaultModel(): string {
  return process.env.FLYD_MODEL ?? "gpt-4o-mini";
}

export function hasApiKey(model?: string): boolean {
  const m = model ?? defaultModel();
  if (isOpenAIModel(m)) return !!process.env.OPENAI_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}

export function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-|o4-)/.test(model);
}
