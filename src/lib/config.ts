import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export const FLYD_DIR = join(homedir(), ".flyd");
export const RAW_DIR = join(FLYD_DIR, "raw");
export const KNOWLEDGE_DIR = join(FLYD_DIR, "knowledge");
export const CONFIG_PATH = join(FLYD_DIR, "config.json");

interface FlydConfig {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  FLYD_MODEL?: string;
}

function loadConfig(): FlydConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(updates: Partial<FlydConfig>): void {
  mkdirSync(FLYD_DIR, { recursive: true });
  const current = loadConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...updates }, null, 2), "utf8");
}

export function getKey(key: keyof FlydConfig): string | undefined {
  return process.env[key] ?? loadConfig()[key];
}

export function defaultModel(): string {
  return getKey("FLYD_MODEL") ?? "gpt-4o-mini";
}

export function hasApiKey(model?: string): boolean {
  const m = model ?? defaultModel();
  if (isOpenAIModel(m)) return !!getKey("OPENAI_API_KEY");
  return !!getKey("ANTHROPIC_API_KEY");
}

export function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-|o4-)/.test(model);
}
