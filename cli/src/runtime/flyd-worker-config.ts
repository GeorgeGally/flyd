import { readFileSync } from "fs";
import { join } from "path";
import { allowedForText } from "./provider-policy.js";
import { claudeApiKey, spendStatus } from "../lib/claude-spend.js";
import { modelRoutes, type ModelRoute, type ModelRouting } from "./model-routing.js";

export interface FlydWorkerConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  providerIdentity: string;
}

const OPENCODE_ENDPOINTS: Record<string, string> = {
  opencode: "https://opencode.ai/inference/openai/v1",
  "opencode-go": "https://opencode.ai/inference/go/openai/v1",
};

const OPENCODE_MODEL_PREFIX = /^(opencode-go|opencode)\//;

export function opencodeProviderFor(model?: string, provider?: string): string | null {
  const named = (provider ?? "").trim().toLowerCase();
  if (named in OPENCODE_ENDPOINTS) return named;
  const match = (model ?? "").trim().match(OPENCODE_MODEL_PREFIX);
  return match ? match[1] : null;
}

export function opencodeEndpoint(provider: string): string {
  return OPENCODE_ENDPOINTS[provider] ?? OPENCODE_ENDPOINTS.opencode;
}

/**
 * A provider-qualified model ("commandcode:deepseek/deepseek-v4-flash",
 * "openai:gpt-5.6-luna") names its provider explicitly, so fallback chains can
 * mix providers regardless of the global FLYD_PROVIDER.
 */
const QUALIFIED_MODEL = /^(openai|anthropic|commandcode|opencode|opencode-go|openrouter):(.+)$/i;

export function qualifiedModelProvider(model: string): string | null {
  return model.trim().match(QUALIFIED_MODEL)?.[1].toLowerCase() ?? null;
}

export function apiModelId(model: string): string {
  const qualified = model.trim().match(QUALIFIED_MODEL);
  const bare = qualified ? qualified[2] : model;
  return bare.replace(OPENCODE_MODEL_PREFIX, "");
}

export const ANTHROPIC_OPENAI_BASE_URL = "https://api.anthropic.com/v1";

export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";

export function parseEnvFile(content: string): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function readProjectEnv(projectRoot?: string): NodeJS.ProcessEnv {
  if (!projectRoot) return {};
  try {
    return parseEnvFile(readFileSync(join(projectRoot, ".env"), "utf8"));
  } catch {
    return {};
  }
}

function normalizedBaseURL(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadFlydWorkerConfig(input: Parameters<typeof loadFlydWorkerConfigs>[0] = {}): FlydWorkerConfig {
  return loadFlydWorkerConfigs(input)[0];
}

export function loadFlydWorkerConfigs(input: {
  projectRoot?: string;
  environment?: NodeJS.ProcessEnv;
  envFileText?: string;
  /** The routing to read instead of the model config (tests). */
  routing?: ModelRouting;
} = {}): FlydWorkerConfig[] {
  const environment = input.environment ?? process.env;
  const fileEnvironment = input.envFileText === undefined
    ? readProjectEnv(input.projectRoot)
    : parseEnvFile(input.envFileText);
  const values = { ...fileEnvironment, ...environment };
  const claudeKey = values.CLAUDE_API_KEY?.trim() || values.ANTHROPIC_API_KEY?.trim()
    || (input.environment === undefined ? claudeApiKey() : undefined);
  const claudeOn = Boolean(claudeKey) && values.FLYD_CLAUDE?.trim() !== "0" && !spendStatus().capped;
  // The worker's models, in order, from the model-routing config: each with the key its provider needs.
  const connection = (route: ModelRoute): { apiKey: string; model: string; baseURL: string } | null => {
    const withKey = (apiKey: string | undefined, baseURL: string, model = route.model) => apiKey ? { apiKey, model, baseURL } : null;
    switch (route.provider) {
      case "anthropic":
        return claudeOn ? withKey(claudeKey, ANTHROPIC_OPENAI_BASE_URL) : null;
      case "openrouter":
        return withKey(values.OPENROUTER_API_KEY?.trim(), values.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1");
      case "openai":
        return withKey(values.OPENAI_API_KEY?.trim(), "https://api.openai.com/v1");
      case "commandcode":
        return withKey(values.COMMANDCODE_API_KEY?.trim() || values.CMD_API_KEY?.trim(), values.COMMANDCODE_BASE_URL?.trim() || COMMANDCODE_BASE_URL);
      case "opencode":
      case "opencode-go":
        return withKey(values.OPENCODE_API_KEY?.trim(), opencodeEndpoint(route.provider));
      default:
        return null;
    }
  };
  const candidates = modelRoutes("worker", input.routing)
    .map(connection)
    .filter((candidate): candidate is { apiKey: string; model: string; baseURL: string } => Boolean(candidate))
    // Never a banned provider or the ChatGPT allowance, by model or by endpoint (runtime/provider-policy.ts).
    .filter((candidate) => allowedForText(candidate.model) && allowedForText(new URL(candidate.baseURL).host));

  if (candidates.length === 0) {
    throw new Error(
      "No coding model is available: the model config's worker list has none with a key (is Claude off or at its monthly cap?)",
    );
  }

  const mapped = candidates.map((candidate) => {
    const model = apiModelId(candidate.model);
    const baseURL = normalizedBaseURL(candidate.baseURL);
    return {
      apiKey: candidate.apiKey,
      model,
      baseURL,
      providerIdentity: `${new URL(baseURL).host}/${model}`,
    };
  }).filter((candidate, index, all) =>
    all.findIndex((item) => item.providerIdentity === candidate.providerIdentity) === index
  );

  const paid = mapped.filter((c) => !/\/free$/i.test(c.model) && !/\/free$/i.test(c.providerIdentity));
  return paid.length ? paid : mapped;
}

export interface FlydRouterConfig {
  model: string;
  apiKey: string;
  baseURL: string;
}

/**
 * Optional flash-tier route classifier config. Returns null when
 * FLYD_ROUTER_MODEL is unset — the resolver then falls back to regex
 * routing. Key and base URL fall back to the main worker config so a
 * single OpenRouter key can serve both models.
 */
export function loadFlydRouterConfig(input: {
  projectRoot?: string;
  environment?: NodeJS.ProcessEnv;
  envFileText?: string;
} = {}): FlydRouterConfig | null {
  const environment = input.environment ?? process.env;
  const fileEnvironment = input.envFileText === undefined
    ? readProjectEnv(input.projectRoot)
    : parseEnvFile(input.envFileText);
  const values = { ...fileEnvironment, ...environment };

  const model = values.FLYD_ROUTER_MODEL?.trim();
  if (!model || !allowedForText(model)) return null;

  let apiKey = values.FLYD_ROUTER_API_KEY?.trim();
  let baseURL = values.FLYD_ROUTER_BASE_URL?.trim();

  if (!apiKey || !baseURL) {
    try {
      const main = loadFlydWorkerConfig(input);
      apiKey = apiKey || main.apiKey;
      baseURL = baseURL || main.baseURL;
    } catch {
      // No main config either — router unusable without a key.
    }
  }

  if (!apiKey) return null;

  return {
    model,
    apiKey,
    baseURL: normalizedBaseURL(baseURL || "https://openrouter.ai/api/v1"),
  };
}
