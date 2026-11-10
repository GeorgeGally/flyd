import { validateEnvelope, type ContextEnvelope } from "../intelligence/context-envelope.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import type { GeorgeKind } from "../lib/reaches-george.js";

// flyd.delivered: one record per report Flyd tells George.
//
// The seed of the split plan's Phase 1 delivery log. A report is claimed before
// it is said and marked with what became of it after, inside the event store's
// own write lock, so Core and the conversation window never both say it and a
// restart never says it twice. A report that could not be delivered (no Mac
// adapter listening) is said again on a later sweep until it is; one left
// without any outcome (the process died mid-send) is said once more after a
// grace period. Nothing is dropped either.

export const DELIVERED_SOURCE = "flyd.delivered";
export const DELIVERED_SCHEMA = "flyd.delivered.v1";
/** A try this old with no outcome may be tried again: undelivered ones each time, ones cut off mid-send once. */
export const UNFINISHED_CLAIM_MS = 5 * 60_000;

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

export type DeliveryOutcome = "shown" | "kept" | "idle" | "backstage" | "placeholder" | "repeat" | "undelivered";

export interface DeliveredRecord {
  schema: typeof DELIVERED_SCHEMA;
  key: string;
  line: string;
  surface: "notification";
  at: string;
  outcome?: DeliveryOutcome;
  kind?: GeorgeKind;
  work?: string;
  /** Set on a claim held under another name (its link) for the report keyed here. */
  aliasOf?: string;
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

function found(store: IntelligenceEventStore, idempotencyKey: string): boolean {
  return Boolean(store.findByIdempotencyKey(DELIVERED_SOURCE, idempotencyKey));
}

function atOf(event: ReturnType<IntelligenceEventStore["findByIdempotencyKey"]>): number {
  const at = (event?.payload?.delivered as { at?: unknown } | undefined)?.at;
  return typeof at === "string" ? Date.parse(at) : 0;
}

/** The latest try at a report (the claim is try 0), or nothing when it was never claimed. */
function lastTry(store: IntelligenceEventStore, key: string): { n: number; at: number } | undefined {
  let event = store.findByIdempotencyKey(DELIVERED_SOURCE, `claim:${key}`);
  if (!event) return undefined;
  let n = 0;
  for (let next = store.findByIdempotencyKey(DELIVERED_SOURCE, `try:${key}:1`); next; next = store.findByIdempotencyKey(DELIVERED_SOURCE, `try:${key}:${n + 1}`)) {
    event = next;
    n += 1;
  }
  return { n, at: atOf(event) };
}

/** Whether a claimed report with no outcome may be tried again: always when its last try was undelivered, once when one was cut off mid-send. */
function retryable(store: IntelligenceEventStore, key: string, last: { n: number }): boolean {
  return found(store, `undelivered:${key}:${last.n}`) || !found(store, `reclaim:${key}`);
}

/**
 * Claims a report for telling, returning its try number; undefined when it was told already or another
 * process is telling it now. A try with no outcome past the grace period is tried again (see retryable).
 */
export function claimDelivery(store: IntelligenceEventStore, report: DeliveryReport, now = new Date()): number | undefined {
  return store.transaction(() => {
    const record: DeliveredRecord = {
      schema: DELIVERED_SCHEMA, key: report.key, line: report.line, surface: "notification", at: now.toISOString(),
      ...(report.kind ? { kind: report.kind } : {}), ...(report.work ? { work: report.work } : {}),
    };
    const last = lastTry(store, report.key);
    const aliases = [...new Set(report.aliases ?? [])].filter((alias) => alias !== report.key);
    if (!last) {
      if (aliases.some((alias) => found(store, `claim:${alias}`))) return undefined;
      append(store, envelope(record, `claim:${report.key}`, report.evidenceRefs));
      for (const alias of aliases) append(store, envelope({ ...record, key: alias, aliasOf: report.key }, `claim:${alias}`, report.evidenceRefs));
      return 0;
    }
    if (found(store, `outcome:${report.key}`)) return undefined;
    if (now.getTime() - last.at < UNFINISHED_CLAIM_MS || !retryable(store, report.key, last)) return undefined;
    if (!found(store, `undelivered:${report.key}:${last.n}`)) append(store, envelope(record, `reclaim:${report.key}`, report.evidenceRefs));
    append(store, envelope(record, `try:${report.key}:${last.n + 1}`, report.evidenceRefs));
    return last.n + 1;
  });
}

/** Records what became of a try at a claimed report: undelivered leaves it open for a later try. */
export function recordOutcome(store: IntelligenceEventStore, report: DeliveryReport, outcome: DeliveryOutcome, attempt = 0, now = new Date()): void {
  append(store, envelope(
    { schema: DELIVERED_SCHEMA, key: report.key, line: report.line, surface: "notification", at: now.toISOString(), outcome },
    outcome === "undelivered" ? `undelivered:${report.key}:${attempt}` : `outcome:${report.key}`,
    report.evidenceRefs,
  ));
}

/** Every report told, oldest first. */
export function deliveredRecords(store: IntelligenceEventStore): DeliveredRecord[] {
  return store.readSource(DELIVERED_SOURCE)
    .map((event) => event.payload?.delivered as DeliveredRecord | undefined)
    .filter((record): record is DeliveredRecord => Boolean(record?.outcome) && record?.outcome !== "undelivered");
}

export type Say = (title: string, message: string, kind?: GeorgeKind, work?: string) => Promise<DeliveryOutcome | void>;

async function defaultSay(title: string, message: string, kind?: GeorgeKind, work?: string): Promise<DeliveryOutcome> {
  const { deliverNotification } = await import("./agenda.js");
  return deliverNotification(title, message, kind, work);
}

/** Claimed under its own name with no outcome yet, and still to be tried again: it is still to be told. */
function owed(store: IntelligenceEventStore, key: string): boolean {
  const last = lastTry(store, key);
  return Boolean(last) && !found(store, `outcome:${key}`) && retryable(store, key, last!);
}

function openStore(store?: IntelligenceEventStore): IntelligenceEventStore {
  // A test that names no store of its own keeps its deliveries in memory, never in the real home.
  return store ?? new IntelligenceEventStore(process.env.VITEST && !process.env.FLYD_DIR ? { path: ":memory:" } : {});
}

/**
 * Tells George each report exactly once, each in its own line.
 * Returns the reports told now, and those still owed (not delivered yet, to be tried again).
 */
export async function deliverOnce(
  reports: DeliveryReport[],
  options: { store?: IntelligenceEventStore; say?: Say; now?: () => Date } = {},
): Promise<{ told: DeliveryReport[]; owed: DeliveryReport[] }> {
  const store = openStore(options.store);
  const owns = options.store === undefined;
  const say = options.say ?? defaultSay;
  const now = options.now ?? (() => new Date());
  try {
    const unique = [...new Map(reports.map((report) => [report.key, report])).values()];
    const claimed = unique.flatMap((report) => {
      const attempt = claimDelivery(store, report, now());
      return attempt === undefined ? [] : [{ report, attempt }];
    });
    for (const { report, attempt } of claimed) {
      const outcome = await say("Flyd", report.line, report.kind ?? "deliverable", report.work).catch(() => "undelivered" as const);
      // Not delivered (no adapter listening, Core down): kept open, so a later sweep says it again.
      recordOutcome(store, report, outcome ?? "shown", attempt, now());
    }
    return { told: claimed.map(({ report }) => report), owed: unique.filter((report) => owed(store, report.key)) };
  } finally {
    if (owns) store.close();
  }
}

/** Says again every report still owed (left undelivered, or cut off mid-send), whichever process first claimed it. */
export async function deliverOwed(options: { store?: IntelligenceEventStore; say?: Say; now?: () => Date } = {}): Promise<{ told: DeliveryReport[]; owed: DeliveryReport[] }> {
  const store = openStore(options.store);
  try {
    const open = new Map<string, DeliveryReport>();
    for (const event of store.readSource(DELIVERED_SOURCE)) {
      const record = event.payload?.delivered as DeliveredRecord | undefined;
      if (!record || record.outcome || record.aliasOf || open.has(record.key) || !owed(store, record.key)) continue;
      open.set(record.key, { key: record.key, line: record.line, ...(record.kind ? { kind: record.kind } : {}), ...(record.work ? { work: record.work } : {}), evidenceRefs: event.evidenceRefs ?? [] });
    }
    return open.size ? await deliverOnce([...open.values()], { ...options, store }) : { told: [], owed: [] };
  } finally {
    if (options.store === undefined) store.close();
  }
}

/** The news finished work makes, keyed by the work so either path tells it once. Pure. */
export function finishedReports(decisions: ReadonlyArray<{
  taskId?: string;
  show: boolean;
  notify: boolean;
  evidenceRefs: string[];
  delivery?: { line: string; url?: string };
}>, work: (taskId: string) => string = (taskId) => taskId, owner: (taskId: string) => string | undefined = (taskId) => taskId): DeliveryReport[] {
  return decisions.flatMap((decision) => {
    const owned = decision.taskId ? owner(decision.taskId) : undefined;
    return decision.delivery && decision.taskId && owned && decision.show && decision.notify ? [{
    key: finishedKey(owned),
    line: decision.delivery.line,
    kind: "deliverable" as const,
    work: work(decision.taskId),
    evidenceRefs: decision.evidenceRefs,
    ...(decision.delivery.url ? { aliases: [`link:${decision.delivery.url}`] } : {}),
    }] : [];
  });
}

/** One key per piece of finished work, whichever path reports it (a run or a staff task of the same id). */
export function finishedKey(id: string): string {
  return `work:${id}`;
}
