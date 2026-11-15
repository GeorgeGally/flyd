import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { parseEnvFile } from "../runtime/flyd-worker-config.js";
import {
  apiModelId,
  COMMANDCODE_BASE_URL,
  opencodeProviderFor,
  qualifiedModelProvider,
} from "../runtime/flyd-worker-config.js";
import { allowedForText, refuseForText } from "../runtime/provider-policy.js";
import { CLAUDE_CHAT_MODEL_ID, CLAUDE_QUICK_MODEL_ID, modelRoutes } from "../runtime/model-routing.js";
export { apiModelId, opencodeProviderFor } from "../runtime/flyd-worker-config.js";
import { claudeApiKey, claudeAvailable } from "./claude-spend.js";
import { resolveFlydDir } from "./flyd-dir.js";

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

const IGNORED_MODEL_ENV_VARS = [
  "FLYD_MODEL",
  "FLYD_CHAT_MODEL",
  "FLYD_CHAT_FALLBACK_MODELS",
  "FLYD_CLAUDE_CHAT_MODEL",
  "FLYD_CLAUDE_QUICK_MODEL",
  "FLYD_CREW_MODEL",
  "FLYD_CREW_BACKUP_MODELS",
  "FLYD_DESIGN_MODEL",
  "COMMANDCODE_MODEL",
  "COMMANDCODE_API_KEY_MODEL",
  "OPENROUTER_MODEL",
];

let warnedIgnoredModelEnv = false;

export function warnIgnoredModelEnv(
  environment: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = (message) => console.error(message),
): string[] {
  if (warnedIgnoredModelEnv) return [];
  warnedIgnoredModelEnv = true;
  const ignored = IGNORED_MODEL_ENV_VARS.filter((name) => environment[name] !== undefined);
  if (ignored.length) {
    log(`flyd: ignoring model env vars (${ignored.join(", ")}); models are configured in ~/.flyd/models.json`);
  }
  return ignored;
}

if (!process.env.VITEST) warnIgnoredModelEnv();

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
  CLAUDE_API_KEY?: string;
  CLAUDE_WORKSPACE_ID?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  OPENCODE_API_KEY?: string;
  OPENCODE_API?: string;
  GITHUB_TOKEN?: string;
  FLYD_PROVIDER?: string;
  FLYD_PREDICTIONS?: string;
  FLYD_PREDICTION_MODEL?: string;
  FLYD_MODEL_API_KEY?: string;
  COMMANDCODE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  FLYD_DICTATE_MODEL?: string;
  FLYD_CONVERSATION_LEARN_MODEL?: string;
  CMD_API_KEY?: string;
  COMMANDCODE_BASE_URL?: string;
  FLYD_MODEL_BASE_URL?: string;
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

/**
 * The API jobs' models come from the model-routing config (runtime/model-routing.ts,
 * ~/.flyd/models.json): each job's list in order, provider-qualified
 * ("anthropic:claude-sonnet-5-5"), never a banned provider or the images-only allowance.
 * Claude entries drop out while Claude is off or at its monthly cap, CommandCode ones
 * without its key. An empty list is an error rather than a quiet hop elsewhere.
 */
function apiModelChain(job: "chat" | "quick" | "background"): string[] {
  const chain = modelRoutes(job)
    .filter((route) => route.provider === "anthropic" ? claudeAvailable() : route.provider === "commandcode" ? Boolean(commandCodeKey()) : true)
    .map((route) => `${route.provider}:${route.model}`)
    .filter(allowedForText);
  if (chain.length === 0) {
    throw new Error(`No model can do Flyd's ${job} jobs: the model config lists none that is available (is Claude off or at its monthly cap?)`);
  }
  return [...new Set(chain)];
}

function commandCodeKey(): string | undefined {
  return getKey("COMMANDCODE_API_KEY")?.trim() || getKey("CMD_API_KEY")?.trim() || undefined;
}

/** Background jobs' first model. */
export function defaultModel(): string {
  return apiModelChain("background")[0]!;
}

/** Chat's first model. */
export function defaultChatModel(): string {
  return apiModelChain("chat")[0]!;
}

export const DEFAULT_CLAUDE_CHAT_MODEL = `anthropic:${CLAUDE_CHAT_MODEL_ID}`;
export const DEFAULT_CLAUDE_QUICK_MODEL = `anthropic:${CLAUDE_QUICK_MODEL_ID}`;

/** The job's first Claude model while Claude is on and under its cap; null otherwise. */
function claudeModelFor(job: "chat" | "quick"): string | null {
  if (!claudeAvailable()) return null;
  const route = modelRoutes(job).find((candidate) => candidate.provider === "anthropic");
  return route ? `anthropic:${route.model}` : null;
}

/** Claude for chat while the key is set and the month is under its cap; null otherwise. */
export function claudeChatModel(): string | null {
  return claudeModelFor("chat");
}

/** Claude for quick jobs (routing, rewrites, summaries, status lines, typing); null when off or capped. */
export function claudeQuickModel(): string | null {
  return claudeModelFor("quick");
}

/** Chat models in order: a provider outage or quota wall on one must not leave the personal agent mute. */
export function chatModelChain(): string[] {
  return apiModelChain("chat");
}

/** Quick jobs: room reading, rewrites, the view's routing, retold answers, status lines. */
export function quickModelChain(): string[] {
  return apiModelChain("quick");
}

/** One-shot queries (the news edition, the council, taste, self-improvement). */
export function oneShotModelChain(): string[] {
  return apiModelChain("background");
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
          apiKey: commandCodeKey(),
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
        return { apiKey: claudeApiKey(), keyName: "CLAUDE_API_KEY", baseURL: undefined };
      default:
        // opencode:/opencode-go: never get here: resolveModelConnection refuses them first.
        throw new Error(`Flyd provider "${provider}" is not supported for model ${model}`);
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

/**
 * The provider a model is served by when it names one: a qualified id
 * ("commandcode:deepseek/…"), or a bare id under FLYD_PROVIDER=commandcode,
 * which has no model-name prefix of its own to infer from.
 */
function explicitProvider(model: string): string | null {
  const qualified = qualifiedModelProvider(model);
  if (qualified) return qualified;
  const provider = getKey("FLYD_PROVIDER")?.trim().toLowerCase() ?? "";
  return provider === "commandcode" ? "commandcode" : null;
}

export function resolveModelConnection(model = defaultChatModel()): ModelConnection {
  refuseForText(model, "this call");
  const qualified = explicitProvider(model);
  if (qualified) return qualifiedConnection(qualified, model);
  const canonicalKey = getKey("FLYD_MODEL_API_KEY")?.trim();
  const canonicalBaseURL = getKey("FLYD_MODEL_BASE_URL")?.trim().replace(/\/+$/, "");
  const provider = getKey("FLYD_PROVIDER")?.trim().toLowerCase() ?? "";
  // FLYD_PROVIDER=opencode-go would send a bare id to OpenCode Go.
  const opencode = opencodeProviderFor(model, provider);
  if (opencode) refuseForText(opencode, "this call");
  const useOpenAI = provider === "openai" || isOpenAIModel(model);
  const useAnthropic = !useOpenAI && (provider === "anthropic" || !provider);
  if (!useOpenAI && !useAnthropic) {
    throw new Error(
      `Flyd provider "${provider}" is not supported for chat model ${model}. Supported providers: openai, anthropic`,
    );
  }

  const apiKey = canonicalKey || (useOpenAI ? getKey("OPENAI_API_KEY")?.trim() : claudeApiKey());
  if (!apiKey) {
    const keyName = useOpenAI ? "OPENAI_API_KEY" : "CLAUDE_API_KEY";
    throw new Error(
      `No API key is configured for Flyd model ${model} (provider ${useOpenAI ? "openai" : "anthropic"}): set FLYD_MODEL_API_KEY or ${keyName}`,
    );
  }

  const baseURL = canonicalBaseURL || undefined;
  const providerHost = baseURL
    ? new URL(baseURL).host
    : useOpenAI ? "api.openai.com" : "api.anthropic.com";
  return {
    model,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    providerIdentity: `${providerHost}/${apiModelId(model)}`,
  };
}

/** True when a connection (provider, endpoint and key) can be resolved for the model right now. */
export function hasApiKey(model?: string): boolean {
  try {
    resolveModelConnection(model ?? defaultModel());
    return true;
  } catch {
    return false;
  }
}

/** True when the model is served over an OpenAI-compatible chat API. */
export function usesOpenAITransport(model: string): boolean {
  const qualified = explicitProvider(model);
  if (qualified === "commandcode") return !commandCodeUsesMessages(model);
  if (qualified) return qualified !== "anthropic";
  const provider = getKey("FLYD_PROVIDER")?.trim().toLowerCase() ?? "";
  return isOpenAIModel(model) || provider === "openai";
}

export function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-|o4-)/.test(model);
}
