import { readFileSync } from "fs";
import { join } from "path";

export interface FlydWorkerConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  providerIdentity: string;
}

const MODEL_ALIASES: Record<string, string> = {
  deepseekv4: "deepseek-v4-pro",
  "deepseek-v4": "deepseek-v4-pro",
};

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

export function loadFlydWorkerConfig(input: {
  projectRoot?: string;
  environment?: NodeJS.ProcessEnv;
  envFileText?: string;
} = {}): FlydWorkerConfig {
  return loadFlydWorkerConfigs(input)[0];
}

export function loadFlydWorkerConfigs(input: {
  projectRoot?: string;
  environment?: NodeJS.ProcessEnv;
  envFileText?: string;
} = {}): FlydWorkerConfig[] {
  const environment = input.environment ?? process.env;
  const fileEnvironment = input.envFileText === undefined
    ? readProjectEnv(input.projectRoot)
    : parseEnvFile(input.envFileText);
  const values = { ...fileEnvironment, ...environment };
  const canonicalModel = values.FLYD_MODEL?.trim();
  const provider = (values.FLYD_PROVIDER ?? "").trim().toLowerCase();
  const useOpenAI = provider === "openai" || Boolean(canonicalModel?.startsWith("gpt-"));
  const canonicalKey = values.FLYD_MODEL_API_KEY?.trim()
    || (useOpenAI ? values.OPENAI_API_KEY?.trim() : values.OPENROUTER_API_KEY?.trim());
  const canonicalBaseURL = values.FLYD_MODEL_BASE_URL?.trim()
    || (useOpenAI ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1");
  const compatibilityKey = values.OPENCODE_API?.trim() || values.OPENCODE_API_KEY?.trim();
  const compatibilityModel = values.OPENCODE_MODEL?.trim() || values.OPENOCE_MODEL?.trim();
  const openRouterKey = values.OPENROUTER_API_KEY?.trim();
  const openRouterModel = values.OPENROUTER_MODEL?.trim();
  const candidates = [
    canonicalKey && canonicalModel ? {
      apiKey: canonicalKey,
      model: canonicalModel,
      baseURL: canonicalBaseURL,
    } : null,
    compatibilityKey && compatibilityModel ? {
      apiKey: compatibilityKey,
      model: compatibilityModel,
      baseURL: values.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/zen/v1",
    } : null,
    openRouterKey && openRouterModel ? {
      apiKey: openRouterKey,
      model: openRouterModel,
      baseURL: values.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    } : null,
  ].filter((candidate): candidate is { apiKey: string; model: string; baseURL: string } => Boolean(candidate));

  if (candidates.length === 0) {
    throw new Error(
      "Flyd coding model is not configured. Set FLYD_MODEL_API_KEY and FLYD_MODEL in .env",
    );
  }

  const mapped = candidates.map((candidate) => {
    const model = MODEL_ALIASES[candidate.model.toLowerCase()] ?? candidate.model;
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
  if (!model) return null;

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
    model: MODEL_ALIASES[model.toLowerCase()] ?? model,
    apiKey,
    baseURL: normalizedBaseURL(baseURL || "https://openrouter.ai/api/v1"),
  };
}
