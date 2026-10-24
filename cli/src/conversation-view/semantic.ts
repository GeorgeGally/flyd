import type { ShowItem } from "./show.js";

export const SEMANTIC_KINDS = [
  "conversation",
  "activity",
  "decision",
  "investigation",
  "action",
  "artifact",
  "monitor",
] as const;

export type SemanticKind = typeof SEMANTIC_KINDS[number];
export type SemanticLifecycle = "active" | "interrupted" | "resolved" | "failed";
export type SemanticEventKind = "created" | "updated" | "interrupted" | "resolved" | "failed";
export type WorkObjectKind = "text" | "image" | "document" | "code" | "data" | "message" | "web" | "timeline";

export interface SemanticAction {
  id: string;
  kind: "inspect" | "choose" | "approve" | "revise" | "continue" | "resolve";
  label: string;
  value?: string;
}

export interface SemanticWorkObject {
  kind: WorkObjectKind;
  ref: string;
  label?: string;
  /** Evidence that used to be live but is no longer reachable. */
  closed?: boolean;
}

/** One labelled piece of a shaped answer: what it is about, and what it says. */
export interface ManifestationPart {
  label: string;
  text: string;
}

export interface ManifestationEvidence {
  text: string;
  url?: string;
}

/** The shape an answer takes when Flyd chooses one; prose is the shape it always had. */
export type ManifestationPlan =
  | { form: "prose"; lead: string }
  | { form: "diagnosis"; lead: string; parts: ManifestationPart[]; evidence?: ManifestationEvidence[]; next?: string }
  | {
    form: "comparison";
    lead: string;
    criteria: string[];
    alternatives: Array<{ name: string; values: string[] }>;
    next?: string;
  };

export interface SemanticObject {
  /** Stable identity of the real thing, independent of how it is currently manifested. */
  id: string;
  kind: SemanticKind;
  lifecycle: SemanticLifecycle;
  subject: string;
  summary: string;
  detail?: string;
  project?: string;
  status?: string;
  evidence: SemanticWorkObject[];
  actions: SemanticAction[];
  source: {
    showItemId: string;
    task?: string;
    ref?: string;
  };
  /** Activity is one continuing job; phase changes without changing its identity. */
  activity?: {
    phase: "queued" | "working" | "needs_you" | "paused" | "ready" | "finished";
    started?: string;
  };
  decision?: {
    /** Where a choice is sent. This is routing identity, not presentation. */
    decisionId?: string;
    target: string;
    question: string;
    alternatives: string[];
    recommended?: string;
    replyTo?: string;
  };
  /** Action is one intended state change across approval, execution and outcome. */
  action?: {
    phase: "proposed" | "approved" | "executing" | "completed" | "declined" | "failed";
    operation: string;
    category: "local" | "outward" | "destructive";
    requiresApproval: boolean;
    /** Stable execution identity once this Action becomes an Activity. */
    activityId?: string;
    /** Stable durable result identity once execution produces an Artifact. */
    artifactId?: string;
  };
  /** Monitor is a durable watch. Individual checks may be Activities; the watch survives them. */
  monitor?: {
    phase: "quiet" | "changed" | "needs_you" | "failed" | "resolved";
    condition: string;
    lastCheckedAt?: string;
    lastChangedAt?: string;
    /** Stable Activity identity for a current check, when one is running. */
    activityId?: string;
  };
  /** Artifact is the durable result, independent of the job that produced it. */
  artifact?: {
    type: "plan" | "result" | "document" | "code" | "data" | "image" | "web";
    phase: "draft" | "ready" | "superseded";
    /** The Activity that produced this result, when known. */
    activityId?: string;
    /** The Action whose execution produced this result, when known. */
    actionId?: string;
    /** A later Artifact can supersede this one without erasing it. */
    supersedes?: string;
  };
  /** Investigation is an evidence-backed question, not a layout. */
  investigation?: {
    question: string;
    findings: Array<{
      heading: string;
      summary: string;
      confidence: "high" | "medium" | "low";
      evidenceIds: string[];
    }>;
    uncertainties: string[];
    conflicts: Array<{ topic: string; reason: string; confidence: number }>;
    sourceCount: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface SemanticEvent {
  objectId: string;
  kind: SemanticEventKind;
  at?: string;
  object: SemanticObject;
  previous?: SemanticObject;
}

export type SemanticKindOverride = (item: ShowItem) => SemanticKind | undefined;

const FAILED = /\b(?:failed|error|errored|broken|stuck)\b/i;

export function semanticKindFor(item: ShowItem): SemanticKind {
  if (item.executiveDecisionId) return item.decision ? "decision" : "artifact";
  // A Firstmate task is one Activity for its whole life. A decision or result
  // can happen *inside* that activity without turning the job into a new object.
  if (item.task && item.kind !== "plan") return "activity";
  switch (item.kind) {
    case "call": return "decision";
    case "live": return "activity";
    case "waiting": return "activity";
    case "ready": return "action";
    case "landed": return "artifact";
    case "plan": return "artifact";
    case "next": return "activity";
    case "news": return "conversation";
    case "clear": return "conversation";
  }
}

function activityPhaseFor(item: ShowItem): SemanticObject["activity"] | undefined {
  if (semanticKindFor(item) !== "activity") return undefined;
  const phase =
    item.kind === "call" ? "needs_you"
    : item.kind === "waiting" ? "paused"
    : item.kind === "ready" ? "ready"
    : item.kind === "landed" || item.kind === "clear" ? "finished"
    : item.kind === "next" ? "queued"
    : "working";
  return { phase, ...(item.started ? { started: item.started } : {}) };
}

export function semanticIdentityFor(item: ShowItem): string {
  if (item.task) return `task:${item.task}`;
  if (item.open?.url) return `web:${item.open.url}`;
  if (item.ref) return `message:${item.ref}`;
  return `show:${item.id.replace(/^(?:call|live|ready|waiting|landed|next|plan|news|clear|site):/, "")}`;
}

function lifecycleFor(item: ShowItem): SemanticLifecycle {
  if (FAILED.test(item.status ?? "") || FAILED.test(item.detail ?? "")) return "failed";
  if (item.kind === "call" || item.kind === "waiting") return "interrupted";
  if (item.kind === "landed" || item.kind === "clear") return "resolved";
  return "active";
}

function evidenceFor(item: ShowItem): SemanticWorkObject[] {
  const evidence: SemanticWorkObject[] = [];
  for (const shot of item.shots ?? []) evidence.push({ kind: "image", ref: shot.src, label: shot.label });
  if (item.open) evidence.push({ kind: "web", ref: item.open.url, label: item.open.label, ...(item.open.closed ? { closed: true } : {}) });
  for (const link of item.links ?? []) {
    if (!evidence.some((object) => object.ref === link.url)) evidence.push({ kind: "web", ref: link.url, label: link.label, ...(link.closed ? { closed: true } : {}) });
  }
  return evidence;
}

function actionsFor(item: ShowItem): SemanticAction[] {
  const actions: SemanticAction[] = [];
  for (const choice of item.decision?.choices ?? []) {
    actions.push({ id: `choose:${choice}`, kind: "choose", label: choice, value: choice });
  }
  if (item.open) actions.push({ id: `inspect:${item.open.url}`, kind: "inspect", label: item.open.label, value: item.open.url });
  return actions;
}

export function semanticObjectFromShow(item: ShowItem, override?: SemanticKind): SemanticObject {
  const kind = item.executiveDecisionId ? semanticKindFor(item) : item.task && item.kind !== "plan" ? "activity" : override ?? semanticKindFor(item);
  return {
    id: semanticIdentityFor(item),
    kind,
    lifecycle: lifecycleFor(item),
    subject: item.headline,
    summary: item.why,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.project ? { project: item.project } : {}),
    ...(item.status ? { status: item.status } : {}),
    evidence: evidenceFor(item),
    actions: actionsFor(item),
    source: {
      showItemId: item.id,
      ...(item.task ? { task: item.task } : {}),
      ...(item.ref ? { ref: item.ref } : {}),
    },
    ...(activityPhaseFor(item) ? { activity: activityPhaseFor(item) } : {}),
    ...(item.decision ? {
      decision: {
        ...(item.decision.decisionId ? { decisionId: item.decision.decisionId } : {}),
        target: item.decision.task,
        question: item.decision.question,
        alternatives: item.decision.choices,
        ...(item.decision.recommended ? { recommended: item.decision.recommended } : {}),
        ...(item.decision.replyTo ? { replyTo: item.decision.replyTo } : {}),
      },
    } : {}),
    ...(item.at ? { createdAt: item.at, updatedAt: item.at } : {}),
  };
}

export function semanticObjectsFromShow(items: readonly ShowItem[], override?: SemanticKindOverride): SemanticObject[] {
  return items.map((item) => semanticObjectFromShow(item, override?.(item)));
}

function sameMeaning(a: SemanticObject, b: SemanticObject): boolean {
  return JSON.stringify({
    kind: a.kind, lifecycle: a.lifecycle, subject: a.subject, summary: a.summary, detail: a.detail,
    project: a.project, status: a.status, evidence: a.evidence, actions: a.actions, activity: a.activity, decision: a.decision, investigation: a.investigation, action: a.action, artifact: a.artifact, monitor: a.monitor,
  }) === JSON.stringify({
    kind: b.kind, lifecycle: b.lifecycle, subject: b.subject, summary: b.summary, detail: b.detail,
    project: b.project, status: b.status, evidence: b.evidence, actions: b.actions, activity: b.activity, decision: b.decision, investigation: b.investigation, action: b.action, artifact: b.artifact, monitor: b.monitor,
  });
}

/** Minimal semantic lifecycle events between two snapshots. Missing objects are not guessed to be resolved. */
export function semanticEvents(previous: readonly SemanticObject[], current: readonly SemanticObject[]): SemanticEvent[] {
  const before = new Map(previous.map((object) => [object.id, object]));
  const events: SemanticEvent[] = [];
  for (const object of current) {
    const old = before.get(object.id);
    if (!old) {
      events.push({ objectId: object.id, kind: "created", object, ...(object.updatedAt ? { at: object.updatedAt } : {}) });
      continue;
    }
    if (sameMeaning(old, object)) continue;
    const kind: SemanticEventKind =
      object.lifecycle === "interrupted" && old.lifecycle !== "interrupted" ? "interrupted"
      : object.lifecycle === "resolved" && old.lifecycle !== "resolved" ? "resolved"
      : object.lifecycle === "failed" && old.lifecycle !== "failed" ? "failed"
      : "updated";
    events.push({ objectId: object.id, kind, object, previous: old, ...(object.updatedAt ? { at: object.updatedAt } : {}) });
  }
  return events;
}


export interface ActivitySources {
  calls?: readonly ShowItem[];
  underway?: readonly ShowItem[];
  held?: readonly ShowItem[];
  ready?: readonly ShowItem[];
  next?: readonly ShowItem[];
  done?: readonly ShowItem[];
}

/**
 * The native Activity projection. A task appears exactly once even when legacy
 * presentation lists describe it in several places. Precedence represents the
 * state that most needs George's attention, while semanticIdentityFor keeps the
 * object stable across snapshots.
 */
export function activityObjectsFromShow(source: ActivitySources): SemanticObject[] {
  const ordered = [
    ...(source.calls ?? []),
    ...(source.held ?? []),
    ...(source.underway ?? []),
    ...(source.ready ?? []),
    ...(source.next ?? []),
    ...(source.done ?? []),
  ];
  const seen = new Set<string>();
  const activities: SemanticObject[] = [];
  for (const item of ordered) {
    if (!item.task) continue;
    const object = semanticObjectFromShow(item);
    if (object.kind !== "activity" || seen.has(object.id)) continue;
    seen.add(object.id);
    activities.push(object);
  }
  return activities;
}


export interface DecisionSources {
  calls?: readonly ShowItem[];
}

/**
 * Standalone decisions only. A call attached to a Firstmate task belongs inside
 * that Activity; a conversational choice with its own reply target is a native
 * Decision. Explicit decisions are semantic facts, so Jev is reserved for
 * ambiguous objects rather than asked to rediscover them.
 */
export function decisionObjectsFromShow(source: DecisionSources): SemanticObject[] {
  const seen = new Set<string>();
  const decisions: SemanticObject[] = [];
  for (const item of source.calls ?? []) {
    if (item.task && !item.executiveDecisionId) continue;
    const object = semanticObjectFromShow(item);
    if (object.kind !== "decision" || seen.has(object.id)) continue;
    seen.add(object.id);
    decisions.push(object);
  }
  return decisions;
}


export interface ArtifactSources {
  done?: readonly ShowItem[];
  /** Plans are durable work products even before execution begins. */
  items?: readonly ShowItem[];
}

function artifactTypeFor(item: ShowItem): NonNullable<SemanticObject["artifact"]>["type"] {
  if (item.kind === "plan") return "plan";
  if ((item.shots ?? []).length) return "image";
  if (item.open || (item.links ?? []).length) return "web";
  return "result";
}

function artifactIdentityFor(item: ShowItem): string {
  // A task's Activity keeps task:<id>; its durable result must be a distinct
  // object or the two meanings collapse into one identity.
  if (item.task) return `artifact:task:${item.task}`;
  if (item.ref) return `artifact:message:${item.ref}`;
  return `artifact:${item.id.replace(/^(?:landed|plan):/, "")}`;
}

export function artifactObjectFromShow(item: ShowItem): SemanticObject {
  const activityId = item.task ? `task:${item.task}` : undefined;
  return {
    ...semanticObjectFromShow(item),
    id: artifactIdentityFor(item),
    kind: "artifact",
    lifecycle: "resolved",
    actions: [
      ...actionsFor(item),
      { id: `inspect:${artifactIdentityFor(item)}`, kind: "inspect", label: "Inspect", value: artifactIdentityFor(item) },
    ],
    artifact: {
      type: artifactTypeFor(item),
      phase: "ready",
      ...(activityId ? { activityId } : {}),
    },
  };
}

/**
 * Native durable results. Finished task Activities and their Artifacts are
 * intentionally separate objects linked by activityId; plans are Artifacts
 * directly. Deduplication is by Artifact identity, never presentation bucket.
 */
export function artifactObjectsFromShow(source: ArtifactSources): SemanticObject[] {
  const ordered = [
    ...(source.items ?? []).filter((item) => item.kind === "plan"),
    ...(source.done ?? []),
  ];
  const seen = new Set<string>();
  const artifacts: SemanticObject[] = [];
  for (const item of ordered) {
    if (item.kind !== "landed" && item.kind !== "plan") continue;
    const object = artifactObjectFromShow(item);
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    artifacts.push(object);
  }
  return artifacts;
}


export interface MonitorSource {
  id: string;
  title: string;
  condition?: string;
  detail?: string;
  at: string;
  state?: "quiet" | "changed" | "needs_you" | "failed" | "resolved";
  evidence?: SemanticWorkObject[];
}

/**
 * A durable watch is not the check currently executing. Its identity is the
 * condition being watched; checks may come and go underneath it.
 */
export function monitorObjectFromSource(source: MonitorSource): SemanticObject {
  const phase = source.state ?? "quiet";
  const lifecycle: SemanticLifecycle =
    phase === "needs_you" ? "interrupted"
    : phase === "failed" ? "failed"
    : phase === "resolved" ? "resolved"
    : "active";
  return {
    id: `monitor:${source.id}`,
    kind: "monitor",
    lifecycle,
    subject: source.title,
    summary: source.condition ?? source.title,
    ...(source.detail ? { detail: source.detail } : {}),
    evidence: source.evidence ?? [],
    actions: phase === "resolved" ? [] : [{ id: `resolve:monitor:${source.id}`, kind: "resolve", label: "Stop watching", value: source.id }],
    source: { showItemId: `monitor:${source.id}` },
    monitor: {
      phase,
      condition: source.condition ?? source.title,
      lastCheckedAt: source.at,
      ...(phase === "changed" || phase === "needs_you" ? { lastChangedAt: source.at } : {}),
    },
    createdAt: source.at,
    updatedAt: source.at,
  };
}

export function monitorObjectsFromSources(sources: readonly MonitorSource[]): SemanticObject[] {
  const latest = new Map<string, MonitorSource>();
  for (const source of sources) {
    const before = latest.get(source.id);
    if (!before || Date.parse(source.at) >= Date.parse(before.at)) latest.set(source.id, source);
  }
  return [...latest.values()].map(monitorObjectFromSource);
}


export interface SemanticSnapshotSources {
  visible?: readonly SemanticObject[];
  activities?: readonly SemanticObject[];
  decisions?: readonly SemanticObject[];
  artifacts?: readonly SemanticObject[];
  monitors?: readonly SemanticObject[];
}

/**
 * One canonical semantic runtime snapshot.
 *
 * Native structural objects win over legacy/ambiguous projections with the
 * same identity. This is the migration seam: ShowItem may still feed old
 * renderers, but downstream lifecycle/focus code consumes this snapshot.
 */
export function composeSemanticSnapshot(sources: SemanticSnapshotSources): SemanticObject[] {
  const native = [
    ...(sources.activities ?? []),
    ...(sources.decisions ?? []),
    ...(sources.artifacts ?? []),
    ...(sources.monitors ?? []),
  ];
  const nativeIds = new Set(native.map((object) => object.id));
  const result: SemanticObject[] = [];
  const seen = new Set<string>();
  for (const object of [...native, ...(sources.visible ?? []).filter((object) => !nativeIds.has(object.id))]) {
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    result.push(object);
  }
  return result;
}

const FOCUS_PRIORITY: Record<SemanticKind, number> = {
  decision: 70,
  action: 65,
  investigation: 50,
  activity: 40,
  artifact: 30,
  monitor: 20,
  conversation: 10,
};

/**
 * Semantic focus is meaning-driven, not card-order-driven. Interrupted work
 * wins; quiet Monitors deliberately sink until they change or need George.
 * Finished artefacts never take the single focus slot: they live in the right
 * column's Artefacts and Done, so the slot stays for live work and what needs him.
 */
export function semanticFocus(objects: readonly SemanticObject[]): SemanticObject | undefined {
  return objects.filter((object) => object.kind !== "artifact").sort((a, b) => {
    const interrupted = Number(b.lifecycle === "interrupted") - Number(a.lifecycle === "interrupted");
    if (interrupted) return interrupted;
    const monitorA = a.monitor?.phase === "quiet" ? -25 : 0;
    const monitorB = b.monitor?.phase === "quiet" ? -25 : 0;
    const score = (FOCUS_PRIORITY[b.kind] + monitorB) - (FOCUS_PRIORITY[a.kind] + monitorA);
    if (score) return score;
    return (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0) - (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0);
  })[0];
}

/**
 * One definition of "needs George", so the headline count, the corner count and
 * the drill-down are always the same set: a choice of his, interrupted work, a
 * watch that changed, or finished work waiting for his look.
 */
export function needsGeorge(object: SemanticObject): boolean {
  if (object.kind === "decision") return true;
  if (object.lifecycle === "interrupted") return true;
  if (object.monitor?.phase === "changed") return true;
  const phase = object.activity?.phase;
  return phase === "needs_you" || phase === "ready";
}

