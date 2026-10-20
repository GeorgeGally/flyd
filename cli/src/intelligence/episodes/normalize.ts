import type { StoredEvent } from "../event-store.js";
import type { EpisodicEventView } from "./types.js";

function firstIso(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  for (const key of ["occurredAt", "occurred_at", "effectiveAt", "effective_at", "observedAt", "observed_at", "timestamp", "at"]) {
    const value = payload[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return undefined;
}

export function episodicEventView(event: StoredEvent): EpisodicEventView {
  return {
    sequence: event.sequence,
    capturedAt: event.capturedAt,
    eventTime: firstIso(event.payload) ?? event.capturedAt,
    kind: event.kind,
    sourceId: event.sourceId,
    erased: event.erased,
    payload: event.payload,
  };
}
