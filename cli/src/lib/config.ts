import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { parseEnvFile } from "../runtime/flyd-worker-config.js";

export const FLYD_APPLICATION_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function loadFlydEnvironment(
  projectRoot = FLYD_APPLICATION_ROOT,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  let fileEnvironment: NodeJS.ProcessEnv = {};
  try {
    fileEnvironment = parseEnvFile(readFileSync(join(projectRoot, ".env"), "utf8"));
  } catch {
    return environment;
  }

  for (const [key, value] of Object.entries(fileEnvironment)) {
    if (environment[key] === undefined && value !== undefined) environment[key] = value;
  }
  return environment;
}

loadFlydEnvironment();

function resolveFlydDir(): string {
  const configured = process.env.FLYD_DIR?.trim();
  if (configured) return resolve(configured);

  const cwdLocal = join(process.cwd(), ".flyd");
  if (existsSync(cwdLocal)) return cwdLocal;
  return join(homedir(), ".flyd");
}

function detectProject(): { name: string; path: string } {
  const cwd = process.cwd();
  try {
    const url = execSync("git remote get-url origin", { stdio: "pipe", encoding: "utf8", timeout: 3000 }).trim();
    if (url) {
      const ghMatch = url.match(/(?:github\.com[:/])([^\/]+\/[^\/]+?)(?:\.git)?$/);
      if (ghMatch) return { name: ghMatch[1], path: cwd };

      const genericMatch = url.match(/[:/]([^\/]+\/[^\/]+?)(?:\.git)?$/);
      if (genericMatch) return { name: genericMatch[1], path: cwd };

      const repoMatch = url.match(/([^\/]+?)(?:\.git)?$/);
      if (repoMatch) return { name: repoMatch[1], path: cwd };
    }
  } catch {}
  return { name: basename(cwd), path: cwd };
}

export const FLYD_DIR = resolveFlydDir();
export const PROJECT = detectProject();
export const RAW_DIR = join(FLYD_DIR, "raw");
export const CACHE_DIR = join(FLYD_DIR, "cache");
export const CONFIG_PATH = join(FLYD_DIR, "config.json");
export const PLANS_DIR = join(FLYD_DIR, "plans");
export const WIKI_DIR = join(FLYD_DIR, "wiki");
export const CONTEXT_DIR = join(FLYD_DIR, "context");
export const SYNTHESIS_STATE_PATH = join(FLYD_DIR, "synthesis-state.json");
export const INTERESTS_PATH = join(FLYD_DIR, "interests.json");
export const INTERESTS_STATE_PATH = join(FLYD_DIR, "interests-state.json");
export const REVIEW_STATE_PATH = join(FLYD_DIR, "review-state.json");
export const CRYSTALLIZE_STATE_PATH = join(FLYD_DIR, "crystallize-state.json");
export const SKILLS_DIR = join(process.cwd(), ".opencode", "skills");

interface FlydConfig {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GITHUB_TOKEN?: string;
  FLYD_MODEL?: string;
  FLYD_CHAT_MODEL?: string;
  FLYD_MODEL_API_KEY?: string;
  FLYD_MODEL_BASE_URL?: string;
  FLYD_ZODIAC_SIGN?: string;
  LAST30DAYS_SCRIPT?: string;
  LAST30DAYS_TOPICS?: string;
}

export interface ModelConnection {
  model: string;
  apiKey: string;
  baseURL?: string;
  providerIdentity: string;
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
  const model = getKey("FLYD_MODEL")?.trim();
  if (!model) {
    throw new Error("Flyd model is not configured. Set FLYD_MODEL in the project .env");
  }
  return model;
}

export function defaultChatModel(): string {
  const model = getKey("FLYD_CHAT_MODEL")?.trim() || getKey("FLYD_MODEL")?.trim();
  if (!model) {
    throw new Error("Flyd chat model is not configured. Set FLYD_MODEL in the project .env");
  }
  return model;
}

export function resolveModelConnection(model = defaultChatModel()): ModelConnection {
  const canonicalKey = getKey("FLYD_MODEL_API_KEY")?.trim();
  const canonicalBaseURL = getKey("FLYD_MODEL_BASE_URL")?.trim().replace(/\/+$/, "");
  const apiKey = canonicalKey || (isOpenAIModel(model)
    ? getKey("OPENAI_API_KEY")?.trim()
    : getKey("ANTHROPIC_API_KEY")?.trim());
  if (!apiKey) {
    throw new Error(`No API key is configured for Flyd model ${model}`);
  }

  const baseURL = canonicalBaseURL || undefined;
  const providerHost = baseURL
    ? new URL(baseURL).host
    : isOpenAIModel(model) ? "api.openai.com" : "api.anthropic.com";
  return {
    model,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    providerIdentity: `${providerHost}/${model}`,
  };
}

export function zodiacSign(): string | null {
  return getKey("FLYD_ZODIAC_SIGN")?.trim().toLowerCase() || null;
}

export function hasApiKey(model?: string): boolean {
  const m = model ?? defaultModel();
  if (getKey("FLYD_MODEL_API_KEY")) return true;
  if (isOpenAIModel(m)) return !!getKey("OPENAI_API_KEY");
  return !!getKey("ANTHROPIC_API_KEY");
}

export function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-|o4-)/.test(model);
}
