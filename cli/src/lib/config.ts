import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { parseEnvFile } from "../runtime/flyd-worker-config.js";
import {
  apiModelId,
  COMMANDCODE_BASE_URL,
  commandCodeModelId,
  opencodeEndpoint,
  opencodeProviderFor,
  qualifiedModelProvider,
} from "../runtime/flyd-worker-config.js";
export { apiModelId, opencodeProviderFor } from "../runtime/flyd-worker-config.js";

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

// Tests run on the same environment as CI: the developer's .env (real models
// and keys) would otherwise turn hermetic tests into live provider calls.
if (!process.env.VITEST) loadFlydEnvironment();

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
  OPENCODE_API_KEY?: string;
  OPENCODE_API?: string;
  GITHUB_TOKEN?: string;
  FLYD_PROVIDER?: string;
  FLYD_MODEL?: string;
  FLYD_CHAT_MODEL?: string;
  FLYD_CHAT_FALLBACK_MODELS?: string;
  FLYD_MODEL_API_KEY?: string;
  COMMANDCODE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  FLYD_DICTATE_MODEL?: string;
  FLYD_CONVERSATION_LEARN_MODEL?: string;
  CMD_API_KEY?: string;
  COMMANDCODE_MODEL?: string;
  COMMANDCODE_API_KEY_MODEL?: string;
  COMMANDCODE_BASE_URL?: string;
  FLYD_MODEL_BASE_URL?: string;
  FLYD_ZODIAC_SIGN?: string;
  LAST30DAYS_SCRIPT?: string;
  LAST30DAYS_TOPICS?: string;
  FLYD_BRIEF_INTERVAL_MINUTES?: string;
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

/**
 * Ordered chat models: the configured chat model, then FLYD_CHAT_FALLBACK_MODELS
 * (comma-separated, provider-qualified like "openai:gpt-5.6-luna"), then
 * CommandCode whenever its key is present. A provider outage or quota wall on
 * one entry must not leave the personal agent mute.
 */
export function chatModelChain(): string[] {
  return [...new Set([defaultChatModel(), ...fallbackModelChain()])];
}

/** Fallback models only, in order; shared by chat and one-shot queries. */
export function fallbackModelChain(): string[] {
  const chain: string[] = [];
  for (const entry of (getKey("FLYD_CHAT_FALLBACK_MODELS") ?? "").split(",")) {
    if (entry.trim()) chain.push(entry.trim());
  }
  if (getKey("COMMANDCODE_API_KEY")?.trim() || getKey("CMD_API_KEY")?.trim()) {
    const configured = getKey("COMMANDCODE_MODEL")?.trim() || getKey("COMMANDCODE_API_KEY_MODEL")?.trim();
    chain.push(`commandcode:${commandCodeModelId(configured)}`);
  }
  return [...new Set(chain)];
}

/** CommandCode serves Claude only through its Anthropic Messages endpoint. */
function commandCodeUsesMessages(model: string): boolean {
  return /^claude-/i.test(apiModelId(model));
}

function qualifiedConnection(provider: string, model: string): ModelConnection {
  const id = apiModelId(model);
  const setting = (() => {
    switch (provider) {
      case "commandcode":
        return {
          apiKey: getKey("COMMANDCODE_API_KEY")?.trim() || getKey("CMD_API_KEY")?.trim(),
          keyName: "COMMANDCODE_API_KEY",
          // The Anthropic SDK appends /v1/messages itself.
          baseURL: (getKey("COMMANDCODE_BASE_URL")?.trim().replace(/\/+$/, "") || COMMANDCODE_BASE_URL)
            .replace(commandCodeUsesMessages(model) ? /\/v1$/ : /$^/, ""),
        };
      case "openai":
        return { apiKey: getKey("OPENAI_API_KEY")?.trim(), keyName: "OPENAI_API_KEY", baseURL: undefined };
      case "openrouter":
        return { apiKey: getKey("OPENROUTER_API_KEY")?.trim(), keyName: "OPENROUTER_API_KEY", baseURL: OPENROUTER_BASE_URL };
      case "anthropic":
        return { apiKey: getKey("ANTHROPIC_API_KEY")?.trim(), keyName: "ANTHROPIC_API_KEY", baseURL: undefined };
      default:
        return {
          apiKey: getKey("OPENCODE_API_KEY")?.trim() || getKey("OPENCODE_API")?.trim(),
          keyName: "OPENCODE_API_KEY",
          baseURL: opencodeEndpoint(provider),
        };
    }
  })();
  if (!setting.apiKey) {
    throw new Error(`No API key is configured for Flyd model ${model}: set ${setting.keyName}`);
  }
  const host = setting.baseURL
    ? new URL(setting.baseURL).host
    : provider === "openai" ? "api.openai.com" : "api.anthropic.com";
  return {
    model,
    apiKey: setting.apiKey,
    ...(setting.baseURL ? { baseURL: setting.baseURL } : {}),
    providerIdentity: `${host}/${id}`,
  };
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function resolveModelConnection(model = defaultChatModel()): ModelConnection {
  const qualified = qualifiedModelProvider(model);
  if (qualified) return qualifiedConnection(qualified, model);
  const canonicalKey = getKey("FLYD_MODEL_API_KEY")?.trim();
  const canonicalBaseURL = getKey("FLYD_MODEL_BASE_URL")?.trim().replace(/\/+$/, "");
  const provider = getKey("FLYD_PROVIDER")?.trim().toLowerCase() ?? "";
  const opencode = opencodeProviderFor(model, provider);
  const useOpenAI = provider === "openai" || isOpenAIModel(model);
  const useAnthropic = !opencode && !useOpenAI && (provider === "anthropic" || !provider);
  if (!opencode && !useOpenAI && !useAnthropic) {
    throw new Error(
      `Flyd provider "${provider}" is not supported for chat model ${model}. Supported providers: openai, anthropic, opencode, opencode-go`,
    );
  }

  const apiKey = canonicalKey || (opencode
    ? getKey("OPENCODE_API_KEY")?.trim() || getKey("OPENCODE_API")?.trim()
    : useOpenAI
      ? getKey("OPENAI_API_KEY")?.trim()
      : getKey("ANTHROPIC_API_KEY")?.trim());
  if (!apiKey) {
    const keyName = opencode
      ? "OPENCODE_API_KEY"
      : useOpenAI
        ? "OPENAI_API_KEY"
        : "ANTHROPIC_API_KEY";
    throw new Error(
      `No API key is configured for Flyd model ${model} (provider ${opencode ?? (useOpenAI ? "openai" : "anthropic")}): set FLYD_MODEL_API_KEY or ${keyName}`,
    );
  }

  const baseURL = canonicalBaseURL || (opencode ? opencodeEndpoint(opencode) : undefined);
  const providerHost = baseURL
    ? new URL(baseURL).host
    : opencode ? "opencode.ai"
      : useOpenAI ? "api.openai.com" : "api.anthropic.com";
  return {
    model,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    providerIdentity: `${providerHost}/${apiModelId(model)}`,
  };
}

export function zodiacSign(): string | null {
  return getKey("FLYD_ZODIAC_SIGN")?.trim().toLowerCase() || null;
}

export function hasApiKey(model?: string): boolean {
  const m = model ?? defaultModel();
  if (getKey("FLYD_MODEL_API_KEY")) return true;
  const provider = getKey("FLYD_PROVIDER")?.trim().toLowerCase() ?? "";
  if (opencodeProviderFor(m, provider)) {
    return Boolean(getKey("OPENCODE_API_KEY") || getKey("OPENCODE_API"));
  }
  if (provider === "openai" || isOpenAIModel(m)) return !!getKey("OPENAI_API_KEY");
  if (provider === "anthropic" || !provider) return !!getKey("ANTHROPIC_API_KEY");
  return false;
}

/** True when the model is served over an OpenAI-compatible chat API. */
export function usesOpenAITransport(model: string): boolean {
  const qualified = qualifiedModelProvider(model);
  if (qualified === "commandcode") return !commandCodeUsesMessages(model);
  if (qualified) return qualified !== "anthropic";
  const provider = getKey("FLYD_PROVIDER")?.trim().toLowerCase() ?? "";
  return isOpenAIModel(model) || opencodeProviderFor(model, provider) !== null || provider === "openai";
}

export function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-|o4-)/.test(model);
}
