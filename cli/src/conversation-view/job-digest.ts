import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { priceFor } from "../lib/claude-spend.js";
import { FLYD_DIR } from "../lib/config.js";
import { quickQuery } from "../lib/llm.js";

/**
 * One stored reading of an artefact. The jobs column renders this. It never
 * asks a model while drawing. A new artefact is hashed; the same hash is not
 * distilled again.
 */
export interface JobDigest {
  hash: string;
  /** Project name this reading belongs to, when the artefact named one. */
  project?: string;
  changed: string;
  means: string;
  needed: string;
  link?: string;
  at: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD from the token estimate. The ledger records the provider's own charge under source `job-digest`. */
  usd: number;
  /** The model did not return a usable reading. Kept so the same text is not sent again. */
  failed?: boolean;
}

export interface DigestSource {
  hash: string;
  project?: string;
  title: string;
  text: string;
  link?: string;
}

const LINE = 180;
const KEEP = 200;
let inFlight: string | null = null;

export function digestPath(): string {
  return process.env.FLYD_JOB_DIGESTS_PATH?.trim() || join(FLYD_DIR, "job-digests.json");
}

export function digestHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

export function readDigests(path = digestPath()): JobDigest[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { digests?: JobDigest[] };
    return Array.isArray(parsed.digests) ? parsed.digests : [];
  } catch {
    return [];
  }
}

function writeDigests(digests: JobDigest[], path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ digests }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function rememberDigest(digest: JobDigest, path = digestPath()): void {
  const rest = readDigests(path).filter((item) => item.hash !== digest.hash);
  writeDigests([digest, ...rest].slice(0, KEEP), path);
}

const clip = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, LINE);

/** The model's JSON, or null when it is not a 3-line reading. */
export function digestFromModel(text: string, source: DigestSource, usage: { model: string; inputTokens: number; outputTokens: number; usd: number }, at: string): JobDigest | null {
  const body = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const changed = clip(record.changed);
  const means = clip(record.means);
  const needed = clip(record.needed);
  if (!changed && !means && !needed) return null;
  const rawLink = clip(record.link) || source.link || "";
  const link = /^https?:\/\//i.test(rawLink) ? rawLink : undefined;
  return {
    hash: source.hash,
    ...(source.project ? { project: source.project } : {}),
    changed, means, needed,
    ...(link ? { link } : {}),
    at,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usd: usage.usd,
  };
}

function estimate(model: string, input: string, output: string): { model: string; inputTokens: number; outputTokens: number; usd: number } {
  const inputTokens = Math.max(1, Math.ceil(input.length / 4));
  const outputTokens = Math.max(1, Math.ceil(output.length / 4));
  const price = priceFor(model);
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return { model, inputTokens, outputTokens, usd };
}

const PROMPT = [
  "Distill one artefact for George, who is scanning a jobs column. Four short lines, plain words.",
  "Return only JSON: {\"changed\":\"what changed, one line\",\"means\":\"what it means for the work, one line\",\"needed\":\"what is needed from George, or 'Nothing' if it is done\",\"link\":\"the one url to open, or empty\"}",
  "No preamble, no markdown fence. Each line under 30 words.",
].join("\n");

export type DigestAsk = (prompt: string) => Promise<string>;

/** One cheap call. The quick-model chain (Haiku while it is under its cap). Tests pass `ask`. */
export async function distill(source: DigestSource, ask: DigestAsk = defaultAsk, now = new Date()): Promise<JobDigest> {
  const prompt = `${PROMPT}\n\nTitle: ${source.title.slice(0, 200)}\n\n${source.text.slice(0, 4_000)}`;
  const model = "claude-haiku-5-5";
  let text = "";
  try {
    text = await ask(prompt);
  } catch (error) {
    const usage = estimate(model, prompt, "");
    logDigest(source.hash, usage, "failed");
    return { hash: source.hash, ...(source.project ? { project: source.project } : {}), changed: "", means: "", needed: "", at: now.toISOString(), ...usage, failed: true };
  }
  const usage = estimate(model, prompt, text);
  const digest = digestFromModel(text, source, usage, now.toISOString());
  if (!digest) {
    logDigest(source.hash, usage, "unreadable");
    return { hash: source.hash, ...(source.project ? { project: source.project } : {}), changed: "", means: "", needed: "", at: now.toISOString(), ...usage, failed: true };
  }
  logDigest(source.hash, usage, "ok");
  return digest;
}

function logDigest(hash: string, usage: { model: string; inputTokens: number; outputTokens: number; usd: number }, outcome: string): void {
  // estUsd prices the character estimate at Haiku. The provider's own charge is recorded on the Claude ledger under source job-digest.
  console.info(`[job-digest] hash=${hash} outcome=${outcome} model=${usage.model} estIn=${usage.inputTokens} estOut=${usage.outputTokens} estUsd=${usage.usd.toFixed(6)} ledger=job-digest`);
}

async function defaultAsk(prompt: string): Promise<string> {
  return quickQuery(prompt, { source: "job-digest", json: true });
}

/**
 * Distil the first source that is not already stored, then stop. Render never
 * calls this. A second artefact waits until this one is stored.
 */
export function scheduleDigest(sources: DigestSource[], options: { path?: string; ask?: DigestAsk; onStored?: () => void } = {}): Promise<void> | undefined {
  if (process.env.VITEST && !options.ask) return;
  const path = options.path ?? digestPath();
  const have = new Set(readDigests(path).map((digest) => digest.hash));
  const next = sources.find((source) => source.hash && !have.has(source.hash) && source.hash !== inFlight);
  if (!next) return;
  inFlight = next.hash;
  return distill(next, options.ask).then((digest) => {
    rememberDigest(digest, path);
    options.onStored?.();
  }).catch(() => undefined).finally(() => {
    if (inFlight === next.hash) inFlight = null;
  });
}
