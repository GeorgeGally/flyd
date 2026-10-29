import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

/** Character-based estimates, not provider token usage. Component counts overlap totals. */
const estimate = (text: string): number => Math.ceil(text.length / 4);

export function writeContextTrace(input: {
  root?: string;
  limit?: number;
  route: "answer" | "delegate" | "act" | "clarify" | "unplanned" | "account";
  message?: string;
  system: string;
  prompt: string;
  profile: string;
  recalled: string;
  history: string;
  tools: string;
  memoryMs: number;
  turnMs?: number;
  matches: number;
  retrievalRoute?: "lexical" | "hybrid" | "hybrid_failed" | "none";
}): void {
  const root = input.root ?? join(FLYD_DIR, "context-traces");
  const limit = input.limit ?? 512;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}.json`;
  const record = {
    version: 1, at: new Date().toISOString(), route: input.route, ...(input.turnMs === undefined ? {} : { turnMs: input.turnMs }),
    tokenMethod: "characters/4 estimate",
    tokens: { message: estimate(input.message ?? ""), system: estimate(input.system), prompt: estimate(input.prompt), profile: estimate(input.profile), recalled: estimate(input.recalled), history: estimate(input.history), tools: estimate(input.tools) },
    retrieval: { route: input.retrievalRoute ?? "unknown", durationMs: input.memoryMs, matches: input.matches },
  };
  writeFileSync(join(root, name), JSON.stringify(record), { mode: 0o600, flag: "wx" });
  const files = readdirSync(root).filter((file) => /^\d{13}-[\da-f-]{36}\.json$/.test(file)).sort();
  for (const file of files.slice(0, Math.max(0, files.length - limit))) {
    try { unlinkSync(join(root, file)); } catch { /* another turn may already have removed it */ }
  }
}
