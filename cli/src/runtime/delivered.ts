import { validateEnvelope, type ContextEnvelope } from "../intelligence/context-envelope.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import type { GeorgeKind } from "../lib/reaches-george.js";

// flyd.delivered: one record per report Flyd tells George.
//
// The seed of the split plan's Phase 1 delivery log. A report is claimed before
// it is said and marked with what became of it after, inside the event store's
// own write lock, so Core and the conversation window never both say it and a
// restart never says it twice. A claim left without its outcome (the process
// died mid-send) is said once more after a grace period, so nothing is dropped
// either.

export const DELIVERED_SOURCE = "flyd.delivered";
export const DELIVERED_SCHEMA = "flyd.delivered.v1";
/** A claim this old with no outcome was cut off mid-send: it may be said once more. */
export const UNFINISHED_CLAIM_MS = 5 * 60_000;
/** More finished reports than this at once are told as one line, not a run of notifications. */
export const BATCH_OVER = 3;

export interface DeliveryReport {
  /** What the report is about, stable across restarts: "task:flyd-hide-whatsapp-card", "run:domain-…". */
  key: string;
  /** The one line George is told. */
  line: string;
  /** What is being told, for notification policy. */
  kind?: GeorgeKind;
  /** Names the work, for the notification gate. */
  work?: string;
  evidenceRefs?: string[];
  /** Other names the same news goes by (its link): told under any of them, it is not told again. */
  aliases?: string[];
}

export type DeliveryOutcome = "shown" | "kept" | "idle" | "backstage" | "placeholder" | "repeat" | "undelivered" | "batched";

export interface DeliveredRecord {
  schema: typeof DELIVERED_SCHEMA;
  key: string;
  line: string;
  surface: "notification";
  at: string;
  outcome?: DeliveryOutcome;
}

function envelope(record: DeliveredRecord, idempotencyKey: string, evidenceRefs: string[] = []): ContextEnvelope {
  return {
    pathKind: "interface",
    kind: "egress_receipt",
    sourceId: DELIVERED_SOURCE,
    consent: { grantedAt: record.at, scopes: ["delivery"] },
    retentionClass: "local_default",
    payloadClassification: "operational",
    provenance: `delivery:${DELIVERED_SCHEMA}`,
    idempotencyKey,
    correlationId: record.key,
    evidenceRefs,
    policyVersion: DELIVERED_SCHEMA,
    payload: { delivered: record },
  };
}

function append(store: IntelligenceEventStore, value: ContextEnvelope): void {
  const validation = validateEnvelope(value, { consentLookup: store });
  if (!validation.ok) throw new Error(`delivery record rejected: ${validation.detail}`);
  store.append(value);
}

function claimedAt(store: IntelligenceEventStore, key: string): number | undefined {
  const event = store.findByIdempotencyKey(DELIVERED_SOURCE, `claim:${key}`);
  const at = (event?.payload?.delivered as { at?: unknown } | undefined)?.at;
  return typeof at === "string" ? Date.parse(at) : event ? 0 : undefined;
}

/** Whether this report was already told (or is being told right now). */
export function wasDelivered(store: IntelligenceEventStore, key: string): boolean {
  return claimedAt(store, key) !== undefined;
}

/**
 * Claims a report for telling; false when it was told already or another process is telling it now.
 * A claim with no outcome past the grace period is reclaimed once.
 */
export function claimDelivery(store: IntelligenceEventStore, report: DeliveryReport, now = new Date()): boolean {
  return store.transaction(() => {
    const record: DeliveredRecord = { schema: DELIVERED_SCHEMA, key: report.key, line: report.line, surface: "notification", at: now.toISOString() };
    const at = claimedAt(store, report.key);
    const aliases = [...new Set(report.aliases ?? [])].filter((alias) => alias !== report.key);
    if (at === undefined) {
      if (aliases.some((alias) => claimedAt(store, alias) !== undefined)) return false;
      append(store, envelope(record, `claim:${report.key}`, report.evidenceRefs));
      for (const alias of aliases) append(store, envelope({ ...record, key: alias }, `claim:${alias}`, report.evidenceRefs));
      return true;
    }
    if (store.findByIdempotencyKey(DELIVERED_SOURCE, `outcome:${report.key}`)) return false;
    if (now.getTime() - at < UNFINISHED_CLAIM_MS) return false;
    if (store.findByIdempotencyKey(DELIVERED_SOURCE, `reclaim:${report.key}`)) return false;
    append(store, envelope(record, `reclaim:${report.key}`, report.evidenceRefs));
    return true;
  });
}

/** Records what became of a claimed report. */
export function recordOutcome(store: IntelligenceEventStore, report: DeliveryReport, outcome: DeliveryOutcome, now = new Date()): void {
  append(store, envelope({ schema: DELIVERED_SCHEMA, key: report.key, line: report.line, surface: "notification", at: now.toISOString(), outcome }, `outcome:${report.key}`, report.evidenceRefs));
}

/** Every report told, oldest first. */
export function deliveredRecords(store: IntelligenceEventStore): DeliveredRecord[] {
  return store.readSource(DELIVERED_SOURCE)
    .map((event) => event.payload?.delivered as DeliveredRecord | undefined)
    .filter((record): record is DeliveredRecord => Boolean(record?.outcome));
}

export type Say = (title: string, message: string, kind?: GeorgeKind, work?: string) => Promise<DeliveryOutcome | void>;

async function defaultSay(title: string, message: string, kind?: GeorgeKind, work?: string): Promise<DeliveryOutcome> {
  const { deliverNotification } = await import("./agenda.js");
  return deliverNotification(title, message, kind, work);
}

/** "a, b and c". Pure. */
function listed(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The one line several finished reports are told as. Pure. */
export function batchLine(reports: DeliveryReport[]): string {
  const names = reports.map((report) => report.work?.trim()).filter((name): name is string => Boolean(name));
  const shown = names.slice(0, 3);
  const more = reports.length - shown.length;
  return shown.length
    ? `${reports.length} pieces of your work are finished: ${listed(more > 0 ? [...shown, `${more} more`] : shown)}.`
    : `${reports.length} pieces of your work are finished.`;
}

/**
 * Tells George each report exactly once. Several at once become one line, so a
 * restart or a backlog of finished work never rings him once per item.
 * Returns the reports told now.
 */
export async function deliverOnce(
  reports: DeliveryReport[],
  options: { store?: IntelligenceEventStore; say?: Say; now?: () => Date } = {},
): Promise<DeliveryReport[]> {
  // A test that names no store of its own keeps its deliveries in memory, never in the real home.
  const store = options.store ?? new IntelligenceEventStore(process.env.VITEST && !process.env.FLYD_DIR ? { path: ":memory:" } : {});
  const owns = options.store === undefined;
  const say = options.say ?? defaultSay;
  const now = options.now ?? (() => new Date());
  try {
    const unique = [...new Map(reports.map((report) => [report.key, report])).values()];
    const claimed = unique.filter((report) => claimDelivery(store, report, now()));
    if (!claimed.length) return [];
    if (claimed.length > BATCH_OVER) {
      const outcome = await say("Flyd", batchLine(claimed), "deliverable").catch(() => "undelivered" as const);
      // Not delivered (Core down): left claimed, so it is said once more after the grace period.
      if (outcome !== "undelivered") for (const report of claimed) recordOutcome(store, report, outcome === "shown" || outcome === undefined ? "batched" : outcome, now());
      return claimed;
    }
    for (const report of claimed) {
      const outcome = await say("Flyd", report.line, report.kind ?? "deliverable", report.work).catch(() => "undelivered" as const);
      if (outcome !== "undelivered") recordOutcome(store, report, outcome ?? "shown", now());
    }
    return claimed;
  } finally {
    if (owns) store.close();
  }
}

/** The news finished work makes, keyed by the work so either path tells it once. Pure. */
export function finishedReports(decisions: ReadonlyArray<{
  taskId?: string;
  show: boolean;
  notify: boolean;
  evidenceRefs: string[];
  delivery?: { line: string; url?: string };
}>, work: (taskId: string) => string = (taskId) => taskId): DeliveryReport[] {
  return decisions.flatMap((decision) => decision.delivery && decision.taskId && decision.show && decision.notify ? [{
    key: finishedKey(decision.taskId),
    line: decision.delivery.line,
    kind: "deliverable" as const,
    work: work(decision.taskId),
    evidenceRefs: decision.evidenceRefs,
    ...(decision.delivery.url ? { aliases: [`link:${decision.delivery.url}`] } : {}),
  }] : []);
}

/** One key per piece of finished work, whichever path reports it (a run or a staff task of the same id). */
export function finishedKey(id: string): string {
  return `work:${id}`;
}
