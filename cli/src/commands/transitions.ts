import { IntelligenceEventStore } from "../intelligence/event-store.js";
import {
  deleteSource,
  exportSourceData,
  governanceSummary,
  type SourceExport,
} from "../intelligence/sensors/governance.js";
import type { SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";
import { transitionSourceRegistry } from "../transitions/writer.js";
import { loadDirectives, saveDirectives } from "../transitions/directives-store.js";

/**
 * Transition-log governance surface (transition-log plan U9).
 *
 * Read-only by default; every destructive flag requires an explicit source
 * id. Erasure delegates to the existing governance controls — nothing here
 * reimplements deletion.
 */

const LIST_CAP = 50;
/** Surfaces whose corrections produce behavioural directives. */
const USER_FACING_TRANSITION_SOURCES = new Set(["transition.overlay", "transition.cli-chat"]);

export interface TransitionsSnapshot {
  sources: ReturnType<typeof governanceSummary>;
  events: Array<{
    sequence: number;
    capturedAt: string;
    sourceId: string;
    kind: string;
    correlationId?: string;
    erased: boolean;
    summary: string;
  }>;
  directives: Array<{ text: string; active: boolean; sourceSeq: number; occurrences: number; utility: number; negatives: number }>;
}

export function buildSnapshot(store: IntelligenceEventStore, registry: SourceContractRegistry): TransitionsSnapshot {
  const all = [...store.readFrom(0)].reverse();
  const events = all
    .filter((e) => e.sourceId.startsWith("transition."))
    .slice(0, LIST_CAP)
    .map((e) => ({
      sequence: e.sequence,
      capturedAt: e.capturedAt,
      sourceId: e.sourceId,
      kind: e.kind,
      ...(e.correlationId ? { correlationId: e.correlationId } : {}),
      erased: e.erased,
      summary: summarizePayload(e.payload),
    }));
  return {
    sources: governanceSummary(store, registry),
    events,
    directives: loadDirectives().map((d) => ({
      text: d.text,
      active: d.active,
      sourceSeq: d.sourceSeq,
      occurrences: d.occurrences,
      utility: d.utility,
      negatives: d.negatives,
    })),
  };
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const action = p.action as Record<string, unknown> | undefined;
  const nextState = p.nextState as Record<string, unknown> | undefined;
  if (action) return String(action.intent ?? "");
  if (nextState) return `signal=${String(nextState.signal)}${nextState.correction ? " (correction)" : ""}`;
  if (p.verdict !== undefined) return `verdict=${String(p.verdict)} conf=${String(p.confidence)}`;
  return "";
}

type ErasureTombstone = Exclude<ReturnType<IntelligenceEventStore["latestTombstone"]>, null>;

export interface ForgetResult {
  sourceId: string;
  tombstone: ErasureTombstone;
  judgeTombstone?: ErasureTombstone;
  removedDirectives: number;
}

/**
 * Deletion rule: a directive carries the sequence of the transition event
 * that produced it (`sourceSeq`); forgetting a surface removes every
 * directive whose sourceSeq falls within that surface's stored events.
 * Judgments live in one operational source (`transition.judge`) regardless
 * of which surface they judged, so forgetting a user-facing surface clears
 * the whole judgment log alongside it (plan R8: deletion sweeps
 * transitions, judgments, and directives).
 */
export function forgetSource(
  store: IntelligenceEventStore,
  registry: SourceContractRegistry,
  sourceId: string,
): ForgetResult {
  if (!USER_FACING_TRANSITION_SOURCES.has(sourceId) && sourceId !== "transition.harness" && sourceId !== "transition.judge") {
    throw new Error(`unknown transition source: ${sourceId}`);
  }
  const sequences = new Set(
    store.readFrom(0).filter((e) => e.sourceId === sourceId).map((e) => e.sequence),
  );
  const kept = [];
  let removedDirectives = 0;
  for (const directive of loadDirectives()) {
    if (sequences.has(directive.sourceSeq)) removedDirectives += 1;
    else kept.push(directive);
  }
  if (removedDirectives > 0) saveDirectives(kept);

  const result = deleteSource(store, registry, sourceId);
  let judgeTombstone: ForgetResult["judgeTombstone"];
  if (USER_FACING_TRANSITION_SOURCES.has(sourceId)) {
    judgeTombstone = deleteSource(store, registry, "transition.judge").tombstone ?? undefined;
  }
  return {
    sourceId,
    tombstone: result.tombstone as ErasureTombstone,
    ...(judgeTombstone ? { judgeTombstone } : {}),
    removedDirectives,
  };
}

function openStore(): IntelligenceEventStore {
  return new IntelligenceEventStore();
}

export async function runTransitions(
  opts: { json?: boolean; forget?: string; export?: string } = {},
): Promise<void> {
  const registry = transitionSourceRegistry();

  if (opts.forget) {
    const store = openStore();
    try {
      const result = forgetSource(store, registry, opts.forget);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`forgot ${result.sourceId}: ${result.tombstone.eventCount} events erased`);
      if (result.judgeTombstone) {
        console.log(`forgot transition.judge: ${result.judgeTombstone.eventCount} judgments erased`);
      }
      console.log(`directive rule: directives whose sourceSeq fell within ${result.sourceId}'s events removed (${result.removedDirectives})`);
      console.log(`audit tombstones written; source is revoked until re-registered`);
    } finally {
      store.close();
    }
    return;
  }

  if (opts.export) {
    const store = openStore();
    try {
      const exported: SourceExport = exportSourceData(store, opts.export);
      console.log(JSON.stringify(exported, null, 2));
    } finally {
      store.close();
    }
    return;
  }

  const store = openStore();
  try {
    const snapshot = buildSnapshot(store, registry);
    if (opts.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }
    console.log("transition sources\n");
    for (const s of snapshot.sources) {
      console.log(`  ${s.sourceId}: ${s.eventCount} events (${s.status})`);
    }
    console.log(`\nrecent events (newest first, max ${LIST_CAP})\n`);
    if (snapshot.events.length === 0) {
      console.log("  none");
    }
    for (const e of snapshot.events) {
      const corr = e.correlationId ? ` ${e.correlationId}` : "";
      const summary = e.summary ? `  ${e.summary}` : "";
      console.log(`  [${e.sequence}] ${e.capturedAt.slice(0, 19)} ${e.sourceId} ${e.kind}${corr}${summary}`);
    }
    console.log(`\ndirectives (${snapshot.directives.length})\n`);
    if (snapshot.directives.length === 0) {
      console.log("  none");
    }
    for (const d of snapshot.directives) {
      console.log(`  - ${d.text}${d.active ? "" : " [inactive]"} (utility ${d.utility}, negatives ${d.negatives}, seen ${d.occurrences})`);
    }
  } finally {
    store.close();
  }
}
