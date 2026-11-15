import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { resolveFlydDir } from "../lib/flyd-dir.js";

/**
 * Flyd's one model-routing config: which provider and model does each job, in order,
 * and which providers are never used. Defaults live here; ~/.flyd/models.json overrides
 * any part of them. Swapping or dropping a provider is a one-line edit there; .env holds
 * keys only. Reference: docs/product/flyd-models.md.
 *
 * Providers: anthropic, openai, openrouter, commandcode (APIs, by key); claude (Claude
 * Code on George's subscription), cursor (cursor-agent), codex (the ChatGPT/Codex allowance).
 */

export const MODEL_JOBS = ["chat", "quick", "background", "worker", "crew", "design", "images"] as const;
export type ModelJob = typeof MODEL_JOBS[number];

export interface ModelRoute {
  provider: string;
  model: string;
}

export interface ModelRouting {
  /** Providers or model families (matched anywhere in "provider:model") no job ever uses. */
  banned: string[];
  /** Providers only the images job may use: George's ChatGPT/Codex allowance. */
  imagesOnly: string[];
  /** Each job's models, first choice first; the rest are its fallbacks. */
  jobs: Record<ModelJob, ModelRoute[]>;
}

export const CLAUDE_CHAT_MODEL_ID = "claude-sonnet-5-5";
export const CLAUDE_QUICK_MODEL_ID = "claude-haiku-5-5";

/** George's rule (2026-11-15): Claude for text and code, Codex for images, OpenCode and DeepSeek never. */
export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  banned: ["opencode", "deepseek"],
  imagesOnly: ["codex"],
  jobs: {
    chat: [{ provider: "anthropic", model: CLAUDE_CHAT_MODEL_ID }],
    quick: [{ provider: "anthropic", model: CLAUDE_QUICK_MODEL_ID }],
    background: [{ provider: "anthropic", model: CLAUDE_QUICK_MODEL_ID }],
    worker: [{ provider: "anthropic", model: CLAUDE_CHAT_MODEL_ID }],
    crew: [{ provider: "claude", model: "default" }],
    design: [{ provider: "claude", model: "opus" }],
    images: [{ provider: "codex", model: "default" }],
  },
};

/** ~/.flyd/models.json; FLYD_MODELS_PATH points elsewhere. Tests never read George's own file. */
export function modelRoutingPath(): string | null {
  const configured = process.env.FLYD_MODELS_PATH?.trim();
  if (configured) return configured;
  return process.env.VITEST ? null : join(resolveFlydDir(), "models.json");
}

let override: ModelRouting | null = null;
let cached: { path: string; stamp: string; routing: ModelRouting; file: Partial<Record<ModelJob, true>> } | null = null;

/** Replace the routing in this process (tests, the eval runner); null goes back to the file. */
export function setModelRouting(routing: { banned?: string[]; imagesOnly?: string[]; jobs?: Partial<Record<ModelJob, ModelRoute[]>> } | null): void {
  override = routing ? merged(routing).routing : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim().toLowerCase()) : null;
}

function routes(value: unknown): ModelRoute[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const provider = typeof item?.provider === "string" ? item.provider.trim().toLowerCase() : "";
    const model = typeof item?.model === "string" ? item.model.trim() : "";
    return provider && model ? [{ provider, model }] : [];
  });
}

function merged(file: Record<string, unknown>): { routing: ModelRouting; file: Partial<Record<ModelJob, true>> } {
  const jobs = (file.jobs && typeof file.jobs === "object" ? file.jobs : {}) as Record<string, unknown>;
  const fromFile: Partial<Record<ModelJob, true>> = {};
  const routing: ModelRouting = {
    banned: strings(file.banned) ?? DEFAULT_MODEL_ROUTING.banned,
    imagesOnly: strings(file.imagesOnly) ?? DEFAULT_MODEL_ROUTING.imagesOnly,
    jobs: Object.fromEntries(MODEL_JOBS.map((job) => {
      const listed = routes(jobs[job]);
      if (listed) fromFile[job] = true;
      return [job, listed ?? DEFAULT_MODEL_ROUTING.jobs[job]];
    })) as Record<ModelJob, ModelRoute[]>,
  };
  return { routing, file: fromFile };
}

function loaded(): { routing: ModelRouting; file: Partial<Record<ModelJob, true>> } {
  if (override) return { routing: override, file: {} };
  const path = modelRoutingPath();
  if (!path || !existsSync(path)) return { routing: DEFAULT_MODEL_ROUTING, file: {} };
  let stamp: string;
  try {
    const { mtimeMs, size } = statSync(path);
    stamp = `${mtimeMs}:${size}`;
  } catch {
    return { routing: DEFAULT_MODEL_ROUTING, file: {} };
  }
  if (cached?.path === path && cached.stamp === stamp) return cached;
  try {
    cached = { path, stamp, ...merged(JSON.parse(readFileSync(path, "utf8"))) };
  } catch (error) {
    console.error(`[flyd] ${path} could not be read, using the default models: ${error instanceof Error ? error.message : String(error)}`);
    cached = { path, stamp, routing: DEFAULT_MODEL_ROUTING, file: {} };
  }
  return cached;
}

export function loadModelRouting(): ModelRouting {
  return loaded().routing;
}

/** What set a job's models, for `flyd doctor`. */
export function modelRoutingSource(job: ModelJob): string {
  if (override) return "in-process override";
  return loaded().file[job] ? `${modelRoutingPath()} jobs.${job}` : "code default";
}

/** True when a model, worker or endpoint names a banned provider or model family. */
export function isBanned(target: string | undefined, routing = loadModelRouting()): boolean {
  const name = (target ?? "").trim().toLowerCase();
  return routing.banned.some((banned) => name.includes(banned));
}

/** True when the target runs on a provider kept for images only. */
export function isImagesOnly(target: string | undefined, routing = loadModelRouting()): boolean {
  const name = (target ?? "").trim().toLowerCase();
  return routing.imagesOnly.some((provider) => name === provider || name.startsWith(`${provider}/`) || name.startsWith(`${provider}:`));
}

/** How the job's callers spell a route: crew and design "provider/model", the API jobs "provider:model". */
export function routeTarget(job: ModelJob, route: ModelRoute): string {
  return job === "crew" || job === "design" ? `${route.provider}/${route.model}` : `${route.provider}:${route.model}`;
}

/**
 * A job's models in order, minus banned providers and, for every job but images, the
 * images-only allowance. The one place a job's model list is read.
 */
export function modelRoutes(job: ModelJob, routing = loadModelRouting()): ModelRoute[] {
  return routing.jobs[job].filter((route) => {
    const target = routeTarget(job, route);
    return !isBanned(target, routing) && (job === "images" || !isImagesOnly(target, routing));
  });
}
