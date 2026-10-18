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
}

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
  decision?: {
    question: string;
    alternatives: string[];
    recommended?: string;
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
  if (item.open) evidence.push({ kind: "web", ref: item.open.url, label: item.open.label });
  for (const link of item.links ?? []) {
    if (!evidence.some((object) => object.ref === link.url)) evidence.push({ kind: "web", ref: link.url, label: link.label });
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
  const kind = override ?? semanticKindFor(item);
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
    ...(item.decision ? {
      decision: {
        question: item.decision.question,
        alternatives: item.decision.choices,
        ...(item.decision.recommended ? { recommended: item.decision.recommended } : {}),
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
    project: a.project, status: a.status, evidence: a.evidence, actions: a.actions, decision: a.decision,
  }) === JSON.stringify({
    kind: b.kind, lifecycle: b.lifecycle, subject: b.subject, summary: b.summary, detail: b.detail,
    project: b.project, status: b.status, evidence: b.evidence, actions: b.actions, decision: b.decision,
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
