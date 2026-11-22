import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Last30days is an evidence supplier, never Flyd's editor or authority.
 * Parse only its versioned *agent* and *discovery* contracts.
 * https://github.com/mvanhorn/last30days-skill/blob/main/docs/reference/json-export.md
 */
export type Last30daysSourceState =
  | "ok" | "no-results" | "partial" | "rate-limited" | "auth-failed"
  | "payment-required" | "unreachable" | "timeout" | "schema-drift"
  | "skipped-unconfigured" | "error";

export interface Last30daysObservation {
  candidateId: string;
  url: string;
  title: string;
  summary: string;
  source: string;
  publishedAt?: string;
  engagement: Record<string, number>;
  relevanceScore?: number;
  cluster?: number;
}

export interface Last30daysCluster {
  title: string;
  summary: string;
  sources: string[];
  engagementTotal: number;
}

export interface Last30daysResearch {
  schemaVersion: string;
  query: string;
  generatedAt: string;
  observations: Last30daysObservation[];
  clusters: Last30daysCluster[];
  sourceStatus: Record<string, Last30daysSourceState>;
  freshnessVerdicts: Array<{ candidateId: string; verdict: string }>;
  usage: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface Last30daysNomination {
  topic: string;
  whySpiking: string;
  velocityScore: number;
  momentum?: string;
  evidenceUrls: string[];
  corroborationCount: number;
  sources: string[];
  previouslySurfacedCount: number;
}

export interface Last30daysDiscovery {
  schemaVersion: string;
  domain: string;
  generatedAt: string;
  outcome: "ok" | "nothing-solid";
  weakSignal?: string;
  sourceStatus: Record<string, Last30daysSourceState>;
  nominations: Last30daysNomination[];
}

export class Last30daysContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Last30daysContractError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function values(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function strings(value: unknown): string[] { return values(value).map(string).filter(Boolean); }

function version(payload: Record<string, unknown>, family: "agent" | "discovery"): string {
  const supplied = string(payload.schema_version);
  const match = /^(\d+)\.(\d+)$/.exec(supplied);
  if (!match || match[1] !== "1") throw new Last30daysContractError("Unsupported last30days " + family + " JSON schema: " + (supplied || "(missing)"));
  return supplied;
}

function safeUrl(value: unknown): string {
  try {
    const url = new URL(string(value));
    if (!["https:", "http:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "0.0.0.0" || host === "::1") return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return ""; }
}

function sourceStates(value: unknown): Record<string, Last30daysSourceState> {
  const states = record(value);
  const allowed = new Set<Last30daysSourceState>([
    "ok", "no-results", "partial", "rate-limited", "auth-failed",
    "payment-required", "unreachable", "timeout", "schema-drift",
    "skipped-unconfigured", "error",
  ]);
  return Object.fromEntries(Object.entries(states).map(([name, state]) => {
    // Upstream reports either state names or per-source objects.
    const raw = typeof state === "string" ? state : string(record(state).status);
    return [name, allowed.has(raw as Last30daysSourceState) ? (raw as Last30daysSourceState) : "error"];
  }));
}

function counters(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, metric]) => {
    const n = number(metric);
    return n !== undefined && n >= 0 ? [[key, n]] : [];
  }));
}

function parseDate(value: unknown): string | undefined {
  const raw = string(value);
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function parseJson(stdout: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(stdout); }
  catch { throw new Last30daysContractError("last30days returned malformed JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Last30daysContractError("last30days output must be a JSON object");
  return record(value);
}

export function parseLast30daysAgent(stdout: string): Last30daysResearch {
  const data = parseJson(stdout);
  const schemaVersion = version(data, "agent");
  if (data.kind === "discovery" || data.comparison === true || !Array.isArray(data.results)
    || !Array.isArray(data.clusters) || !("source_status" in data)) {
    throw new Last30daysContractError("Expected a versioned agent research result");
  }
  const observations = values(data.results).flatMap((entry) => {
    const item = record(entry);
    const url = safeUrl(item.url);
    const title = string(item.title);
    if (!url || !title) return [];
    return [{
      candidateId: string(item.candidate_id) || url,
      url, title,
      summary: string(item.summary).slice(0, 1200),
      source: string(item.source) || "web",
      ...(parseDate(item.published_at) ? { publishedAt: parseDate(item.published_at) } : {}),
      engagement: counters(item.engagement),
      ...(number(item.relevance_score) !== undefined ? { relevanceScore: Math.max(0, Math.min(1, number(item.relevance_score)!)) } : {}),
      ...(Number.isInteger(item.cluster) && Number(item.cluster) >= 0 ? { cluster: Number(item.cluster) } : {}),
    }];
  }).slice(0, 160);
  const clusters = values(data.clusters).map((value) => {
    const item = record(value);
    return {
      title: string(item.title), summary: string(item.summary),
      sources: strings(item.sources), engagementTotal: number(item.engagement_total) ?? 0,
    };
  }).slice(0, 80);
  const usageData = record(data.usage);
  const usageFields = ["calls", "promptTokens", "completionTokens", "totalTokens"] as const;
  const usage = data.usage && usageFields.every((k) => Number.isSafeInteger(usageData[k]) && Number(usageData[k]) >= 0)
    ? { calls: Number(usageData.calls), promptTokens: Number(usageData.promptTokens), completionTokens: Number(usageData.completionTokens), totalTokens: Number(usageData.totalTokens) }
    : null;
  return {
    schemaVersion, query: string(data.query), generatedAt: parseDate(data.generated_at) ?? "",
    observations, clusters, sourceStatus: sourceStates(data.source_status), usage,
    freshnessVerdicts: values(data.freshness_verdicts).flatMap((value) => {
      const item = record(value);
      const candidateId = string(item.candidate_id);
      const verdict = string(item.verdict);
      return candidateId && verdict ? [{ candidateId, verdict }] : [];
    }),
  };
}

export function parseLast30daysDiscovery(stdout: string): Last30daysDiscovery {
  const data = parseJson(stdout);
  const schemaVersion = version(data, "discovery");
  if (data.kind !== "discovery" || !Array.isArray(data.results) || !("source_status" in data)
    || !["ok", "nothing-solid"].includes(string(data.outcome))) {
    throw new Last30daysContractError("Expected a versioned discovery result");
  }
  return {
    schemaVersion,
    domain: string(data.domain),
    generatedAt: parseDate(data.generated_at) ?? "",
    outcome: data.outcome as "ok" | "nothing-solid",
    ...(string(data.weak_signal) ? { weakSignal: string(data.weak_signal) } : {}),
    sourceStatus: sourceStates(data.source_status),
    nominations: values(data.results).flatMap((value) => {
      const item = record(value);
      const topic = string(item.topic).slice(0, 140);
      if (!topic) return [];
      return [{
        topic, whySpiking: string(item.why_spiking).slice(0, 500),
        velocityScore: number(item.velocity_score) ?? 0,
        ...(string(item.momentum) ? { momentum: string(item.momentum) } : {}),
        evidenceUrls: strings(item.evidence_urls).map(safeUrl).filter(Boolean).slice(0, 12),
        corroborationCount: number(item.corroboration_count) ?? 0,
        sources: strings(item.sources),
        previouslySurfacedCount: number(item.previously_surfaced_count) ?? 0,
      }];
    }).slice(0, 40),
  };
}

export function last30daysPath(): string {
  return process.env.FLYD_LAST30DAYS_SCRIPT?.trim()
    || process.env.LAST30DAYS_SCRIPT?.trim()
    || join(homedir(), ".flyd", "vendor", "last30days-skill", "skills", "last30days", "scripts", "last30days.py");
}

export interface Last30daysRunner {
  (executable: string, argv: string[], options: { timeout: number; maxBuffer: number }): Promise<{ stdout: string }>;
}

async function defaultRunner(executable: string, argv: string[], options: { timeout: number; maxBuffer: number }): Promise<{ stdout: string }> {
  return execFileAsync(executable, argv, options);
}

export async function last30daysHealth(script = last30daysPath(), runner: Last30daysRunner = defaultRunner): Promise<{ ok: boolean; detail: string; interpreter: string }> {
  const interpreter = process.env.FLYD_LAST30DAYS_PYTHON?.trim() || "python3";
  if (!existsSync(script)) return { ok: false, detail: "last30days engine is not installed", interpreter };
  try {
    const { stdout } = await runner(interpreter, ["-c", "import sys; print('.'.join(map(str,sys.version_info[:3])))"], { timeout: 5000, maxBuffer: 2048 });
    const pieces = stdout.trim().split(".").map(Number);
    const ok = (pieces[0] ?? 0) > 3 || (pieces[0] === 3 && (pieces[1] ?? 0) >= 12);
    return { ok, detail: ok ? "ready" : "last30days v4 requires Python 3.12 or newer", interpreter };
  } catch {
    return { ok: false, detail: "last30days Python interpreter cannot run", interpreter };
  }
}

async function run(script: string, args: string[], runner: Last30daysRunner, timeoutMs: number): Promise<string> {
  const health = await last30daysHealth(script, runner);
  if (!health.ok) throw new Error(health.detail);
  const { stdout } = await runner(health.interpreter, [script, ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

export async function researchLast30days(topic: string, options: { script?: string; runner?: Last30daysRunner; timeoutMs?: number } = {}): Promise<Last30daysResearch> {
  const args = ["--emit=json", "--days", "30", "--search", "reddit,hackernews,youtube", ...(process.env.FLYD_LAST30DAYS_VERIFY_FRESHNESS === "1" ? ["--verify-freshness"] : []), topic];
  const stdout = await run(options.script ?? last30daysPath(), args, options.runner ?? defaultRunner, options.timeoutMs ?? 240_000);
  return parseLast30daysAgent(stdout);
}

export async function discoverLast30days(domain: string, options: { script?: string; runner?: Last30daysRunner; timeoutMs?: number } = {}): Promise<Last30daysDiscovery> {
  // One-shot is supported for headless/cron; host-judged three-leg discovery is not.
  const args = ["--discover", ...(domain ? [domain] : []), "--emit=json"];
  const stdout = await run(options.script ?? last30daysPath(), args, options.runner ?? defaultRunner, options.timeoutMs ?? 420_000);
  return parseLast30daysDiscovery(stdout);
}
