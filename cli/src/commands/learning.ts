import { readFileSync } from "node:fs";
import { learningRequest } from "../cognition/learning-service.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { exportSourceData } from "../intelligence/sensors/governance.js";
import { CORRECTION_SOURCE, IMPORT_SOURCE, type CorrectionCandidate } from "../dictation/corrections.js";
import type { SourceConsentState, SourceContract } from "../intelligence/sensors/source-contracts.js";

/** The review screen: what's on, what's waiting for his yes, and what already shapes dictation. */
export function formatLearning(body: {
  sources: Array<{ contract: SourceContract; state: SourceConsentState }>;
  corrections: CorrectionCandidate[];
}): string {
  const status = (id: string) => body.sources.find(s => s.contract.sourceId === id)?.state.status ?? "disabled";
  const lines = [`Learning from dictation edits: ${status(CORRECTION_SOURCE) === "enabled" ? "on" : status(CORRECTION_SOURCE)}`];
  if (status(CORRECTION_SOURCE) !== "enabled")
    lines.push("  Turn on “Learn From My Dictation Edits” in the Flyd menu bar menu, then fix a dictated word in place.");
  lines.push(`Conversation import: ${status(IMPORT_SOURCE) === "enabled" ? "on" : status(IMPORT_SOURCE)}`);
  const row = (c: CorrectionCandidate) => `  #${c.sequence}  ${c.from} → ${c.to}  (${c.bundleId})${c.evidenceCount ? ` — ${c.evidenceCount}/3 corrections` : ""}${c.recurrences ? `; ${c.recurrences} recurrence(s), needs investigation` : ""}`;
  const unique = new Map<string, CorrectionCandidate>();
  for (const c of body.corrections) unique.set(c.ruleId ?? String(c.sequence), c);
  const rows = [...unique.values()];
  const pending = rows.filter(c => !c.reviewed && c.status !== "active" && c.status !== "disabled"), approved = rows.filter(c => c.approved);
  if (pending.length) lines.push("", "Waiting for review (flyd learning --approve <n> | --reject <n>):", ...pending.map(row));
  if (approved.length) lines.push("", "Approved — shaping dictation:", ...approved.map(row));
  const automatic = rows.filter(c => c.activation === "automatic");
  if (automatic.length) lines.push("", "Learned automatically — contextual rules in this window:", ...automatic.map(row));
  const disabled = rows.filter(c => c.status === "disabled");
  if (disabled.length) lines.push("", "Disabled — not shaping dictation:", ...disabled.map(row));
  for (const c of pending.filter(c => c.reason)) lines.push(`  #${c.sequence}: ${c.reason}`);
  if (!body.corrections.length) lines.push("", "No corrections learned yet.");
  return lines.join("\n");
}

export async function runLearning(opts: {
  import?: string; enable?: string; pause?: string; disable?: string;
  erase?: string; approve?: string; reject?: string; process?: boolean; export?: string; json?: boolean;
}): Promise<void> {
  let path = "/learning", method = "GET", body: unknown = {};
  if (opts.export) {
    if (![CORRECTION_SOURCE, IMPORT_SOURCE].includes(opts.export)) throw new Error("Unknown learning source");
    const store = new IntelligenceEventStore();
    try { console.log(JSON.stringify(exportSourceData(store, opts.export), null, 2)); }
    finally { store.close(); }
    return;
  }
  for (const action of ["enable", "pause", "disable", "erase"] as const) if (opts[action]) {
    path = "/learning/source"; method = "POST"; body = { sourceId: opts[action], action };
  }
  if (opts.import) {
    path = "/learning/conversations"; method = "POST"; body = JSON.parse(readFileSync(opts.import, "utf8"));
  }
  if (opts.approve || opts.reject) {
    path = "/dictation/review"; method = "POST";
    body = { sequence: Number(opts.approve ?? opts.reject), approved: !!opts.approve };
  }
  if (opts.process) { path = "/learning/process"; method = "POST"; }
  const result = await learningRequest(path, method, body);
  console.log(path === "/learning" && !opts.json && result.status < 400
    ? formatLearning(result.body as Parameters<typeof formatLearning>[0])
    : JSON.stringify(result.body, null, 2));
  if (result.status >= 400) process.exitCode = 1;
}
