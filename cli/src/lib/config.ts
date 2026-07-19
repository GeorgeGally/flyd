import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename, resolve } from "path";
import { execSync } from "child_process";

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
