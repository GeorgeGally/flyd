import { readFileSync } from "node:fs";
import { learningRequest } from "../cognition/learning-service.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { exportSourceData } from "../intelligence/sensors/governance.js";
import { CORRECTION_SOURCE, IMPORT_SOURCE } from "../dictation/corrections.js";

export async function runLearning(opts: {
  import?: string; enable?: string; pause?: string; disable?: string;
  erase?: string; approve?: string; reject?: string; process?: boolean; export?: string;
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
  console.log(JSON.stringify(result.body, null, 2));
  if (result.status >= 400) process.exitCode = 1;
}
