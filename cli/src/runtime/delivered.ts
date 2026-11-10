import { validateEnvelope, type ContextEnvelope } from "../intelligence/context-envelope.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import type { GeorgeKind } from "../lib/reaches-george.js";

// flyd.delivered: one record per report Flyd tells George.
//
// The seed of the split plan's Phase 1 delivery log. A report is claimed before
// it is said and marked with what became of it after, inside the event store's
// own write lock, so no two processes both say it and a restart never says it
// twice. A report that could not be delivered (no Mac
// adapter listening) is said again on later sweeps, each wait twice the last,
// up to MAX_TRIES tries; one left without any outcome (the process died
// mid-send) is said once more. Whatever is not told stays on its Jobs row.

export const DELIVERED_SOURCE = "flyd.delivered";
export const DELIVERED_SCHEMA = "flyd.delivered.v1";
/** The wait before a try with no outcome is tried again; it doubles with each try. */
export const UNFINISHED_CLAIM_MS = 5 * 60_000;
/** Tries after the first before a report no adapter took is given up (about five hours of waits in all). */
export const MAX_TRIES = 6;
/** How far back the sweep reads: longer than every wait together. */
const OWED_WINDOW_MS = 24 * 60 * 60_000;

export interface DeliveryReport {
  /** What the report is about, stable across restarts: "work:domain-…" (finishedKey), "run:domain-…:<hash>". */
  key: string;
  /** The one line George is told. */
  line: string;
  /** What is being told, for notification policy. */
  kind?: GeorgeKind;
  /** Names the work, for the notification gate. */
  work?: string;
  evidenceRefs?: string[];
}

export type DeliveryOutcome = "shown" | "kept" | "idle" | "backstage" | "placeholder" | "repeat" | "undelivered" | "seeded" | "briefed";

/** A report held for a natural break (runtime/attention.ts): told later, batched, or in the morning brief. */
export interface HeldFor {
  until: "break" | "meeting";
  /** What he was on when it was held. */
  focus?: string;
  finished?: boolean;
  /** The run it reports on, whose told line is recorded when it is said. */
  run?: string;
  decisionId?: string;
}

export interface DeliveredRecord {
  schema: typeof DELIVERED_SCHEMA;
  key: string;
  line: string;
  surface: "notification";
  at: string;
  outcome?: DeliveryOutcome;
  kind?: GeorgeKind;
  work?: string;
  held?: HeldFor;
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

/**
 * The latest try at a report (the claim is try 0), or nothing when it was never claimed. At most MAX_TRIES
 * lookups.
 */
function lastTry(store: IntelligenceEventStore, key: string): { n: number; at: number } | undefined {
  const claim = store.findByIdempotencyKey(DELIVERED_SOURCE, `claim:${key}`);
  if (!claim) return undefined;
  let event = claim;
  let n = 0;
  while (n < MAX_TRIES) {
    const next = store.findByIdempotencyKey(DELIVERED_SOURCE, `try:${key}:${n + 1}`);
    if (!next) break;
    event = next;
    n += 1;
  }
  return { n, at: atOf(event) };
}

/**
 * Whether a claimed report with no outcome may still be tried: under the cap, and either its last try was
 * undelivered or none was yet cut off mid-send (that is said once more only).
 */
function retryable(store: IntelligenceEventStore, key: string, last: { n: number }): boolean {
  return last.n < MAX_TRIES && (found(store, `undelivered:${key}:${last.n}`) || !found(store, `reclaim:${key}`));
}

/** When the next try may go: the wait doubles with each try. */
function due(last: { n: number; at: number }, now: Date): boolean {
  return now.getTime() - last.at >= UNFINISHED_CLAIM_MS * 2 ** last.n;
}

/**
 * Claims a report for telling, returning its try number; undefined when it was told already or another
 * process is telling it now. A try with no outcome past the grace period is tried again (see retryable).
 */
function claimDelivery(store: IntelligenceEventStore, report: DeliveryReport, now = new Date()): number | undefined {
  return store.transaction(() => {
    const record: DeliveredRecord = {
      schema: DELIVERED_SCHEMA, key: report.key, line: report.line, surface: "notification", at: now.toISOString(),
      ...(report.kind ? { kind: report.kind } : {}), ...(report.work ? { work: report.work } : {}),
    };
    const last = lastTry(store, report.key);
    if (!last) {
      append(store, envelope(record, `claim:${report.key}`, report.evidenceRefs));
      return 0;
    }
    if (found(store, `outcome:${report.key}`)) return undefined;
    if (!due(last, now) || !retryable(store, report.key, last)) return undefined;
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

export type Say = (title: string, message: string, kind?: GeorgeKind, work?: string) => Promise<DeliveryOutcome | void>;

async function defaultSay(title: string, message: string, kind?: GeorgeKind, work?: string): Promise<DeliveryOutcome> {
  const { deliverNotification } = await import("./agenda.js");
  return deliverNotification(title, message, kind, work, { once: true });
}

/** Claimed with no outcome yet, and still to be tried again: it is still to be told. */
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
  options: { store?: IntelligenceEventStore; say?: Say; now?: () => Date; together?: (claimed: DeliveryReport[]) => string } = {},
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
    if (options.together && claimed.length > 1) {
      // Held reports come out together as one line (runtime/attention.ts); a call among them keeps a decision's gate.
      const lead = claimed.find(({ report }) => report.kind === "decision")?.report ?? claimed[0]!.report;
      const outcome = await say("Flyd", options.together(claimed.map(({ report }) => report)), lead.kind ?? "deliverable", lead.work).catch(() => "undelivered" as const);
      for (const { report, attempt } of claimed) recordOutcome(store, report, outcome ?? "shown", attempt, now());
    } else {
      for (const { report, attempt } of claimed) {
        const outcome = await say("Flyd", report.line, report.kind ?? "deliverable", report.work).catch(() => "undelivered" as const);
        // Not delivered (no adapter listening, Core down): kept open, so a later sweep says it again.
        recordOutcome(store, report, outcome ?? "shown", attempt, now());
      }
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
    for (const event of store.readSourcePage(DELIVERED_SOURCE, { after: new Date(Date.now() - OWED_WINDOW_MS).toISOString(), limit: 5_000 })) {
      const record = event.payload?.delivered as DeliveredRecord | undefined;
      if (!record || record.outcome || open.has(record.key) || !owed(store, record.key)) continue;
      open.set(record.key, { key: record.key, line: record.line, ...(record.kind ? { kind: record.kind } : {}), ...(record.work ? { work: record.work } : {}), evidenceRefs: event.evidenceRefs ?? [] });
    }
    return open.size ? await deliverOnce([...open.values()], { ...options, store }) : { told: [], owed: [] };
  } finally {
    if (options.store === undefined) store.close();
  }
}

function recordTold(store: IntelligenceEventStore, key: string, at: string, outcome: DeliveryOutcome): void {
  if (found(store, `claim:${key}`)) return;
  const record: DeliveredRecord = { schema: DELIVERED_SCHEMA, key, line: "", surface: "notification", at };
  append(store, envelope(record, `claim:${key}`));
  append(store, envelope({ ...record, outcome }, `outcome:${key}`));
}

/** Records reports as handled without telling them (seen where he asked, or Flyd's own): nothing tells them later. */
export function markTold(keys: string[], options: { store?: IntelligenceEventStore; now?: () => Date } = {}): void {
  if (!keys.length) return;
  const store = openStore(options.store);
  try {
    const at = (options.now?.() ?? new Date()).toISOString();
    store.transaction(() => { for (const key of new Set(keys)) recordTold(store, key, at, "kept"); });
  } finally {
    if (options.store === undefined) store.close();
  }
}

/** Marks that finished work on record when this shipped was seeded; later finished work is told. */
const SEED_MARK = "seed:finished.v1";

/**
 * Once ever: records every finished report already on record as told, without telling it, so work George already
 * knew about never rings on the upgrade. Returns false (doing nothing) on every later call.
 */
export function seedOnce(keys: string[], options: { store?: IntelligenceEventStore; now?: () => Date } = {}): boolean {
  const store = openStore(options.store);
  try {
    return store.transaction(() => {
      if (found(store, SEED_MARK)) return false;
      const at = (options.now?.() ?? new Date()).toISOString();
      for (const key of new Set(keys)) recordTold(store, key, at, "seeded");
      append(store, envelope({ schema: DELIVERED_SCHEMA, key: SEED_MARK, line: "", surface: "notification", at, outcome: "seeded" }, SEED_MARK));
      return true;
    });
  } finally {
    if (options.store === undefined) store.close();
  }
}

/** How far back held reports are read: past the next morning brief. */
const HELD_WINDOW_MS = 48 * 60 * 60_000;

/** Holds a report for a natural break; nothing when it was held or told already. */
export function holdReport(report: DeliveryReport, held: HeldFor, options: { store?: IntelligenceEventStore; now?: () => Date } = {}): void {
  const store = openStore(options.store);
  try {
    store.transaction(() => {
      if (found(store, `held:${report.key}`) || found(store, `claim:${report.key}`)) return;
      const record: DeliveredRecord = {
        schema: DELIVERED_SCHEMA, key: report.key, line: report.line, surface: "notification", at: (options.now?.() ?? new Date()).toISOString(), held,
        ...(report.kind ? { kind: report.kind } : {}), ...(report.work ? { work: report.work } : {}),
      };
      append(store, envelope(record, `held:${report.key}`, report.evidenceRefs));
    });
  } finally {
    if (options.store === undefined) store.close();
  }
}

/** Reports still held: held, and neither told nor briefed since. */
export function heldReports(options: { store?: IntelligenceEventStore; now?: () => Date } = {}): Array<DeliveryReport & { at: string; held: HeldFor }> {
  const store = openStore(options.store);
  try {
    const after = new Date((options.now?.() ?? new Date()).getTime() - HELD_WINDOW_MS).toISOString();
    const held = new Map<string, DeliveryReport & { at: string; held: HeldFor }>();
    for (const event of store.readSourcePage(DELIVERED_SOURCE, { after, limit: 5_000 })) {
      const record = event.payload?.delivered as DeliveredRecord | undefined;
      if (!record?.held || held.has(record.key) || found(store, `claim:${record.key}`)) continue;
      held.set(record.key, {
        key: record.key, line: record.line, at: record.at, held: record.held, evidenceRefs: event.evidenceRefs ?? [],
        ...(record.kind ? { kind: record.kind } : {}), ...(record.work ? { work: record.work } : {}),
      });
    }
    return [...held.values()];
  } finally {
    if (options.store === undefined) store.close();
  }
}

/** Held reports told in the morning brief: nothing tells them again. */
export function markBriefed(keys: string[], options: { store?: IntelligenceEventStore; now?: () => Date } = {}): void {
  if (!keys.length) return;
  const store = openStore(options.store);
  try {
    const at = (options.now?.() ?? new Date()).toISOString();
    store.transaction(() => { for (const key of new Set(keys)) recordTold(store, key, at, "briefed"); });
  } finally {
    if (options.store === undefined) store.close();
  }
}

/** One key per piece of finished work: the id of the run Core announces it for. */
export function finishedKey(id: string): string {
  return `work:${id}`;
}
