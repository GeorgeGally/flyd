import { createHash } from "node:crypto";
import { FirstmateDomainTransport } from "./firstmate.js";
import { listDomainRuns, saveDomainRun } from "./store.js";
import type { DomainId, DomainMessage, DomainMessageKind, DomainRun } from "./types.js";

const ACTIVE = new Set(["queued", "accepted", "working", "needs_decision"]);

export function activeDomainRuns(domain?: DomainId): DomainRun[] {
  return listDomainRuns().filter((run) => ACTIVE.has(run.status) && (!domain || run.request.domain === domain));
}

function messageId(run: DomainRun, kind: DomainMessageKind, body: string): string {
  const digest = createHash("sha256").update(`${run.id}\0${kind}\0${body.trim()}`).digest("hex").slice(0, 20);
  return `${run.id}:${kind}:${digest}`;
}

export interface DomainMessageOutcome {
  delivered: boolean;
  run?: DomainRun;
  reason?: "no_active_run" | "ambiguous_active_runs" | "unsupported_domain" | "delivery_failed";
  error?: string;
}

export async function sendDomainMessage(input: {
  domain: DomainId;
  kind: DomainMessageKind;
  body: string;
  transport?: FirstmateDomainTransport;
}): Promise<DomainMessageOutcome> {
  const body = input.body.trim();
  if (!body) return { delivered: false, reason: "delivery_failed", error: "Empty domain message" };
  const candidates = activeDomainRuns(input.domain);
  if (candidates.length === 0) return { delivered: false, reason: "no_active_run" };
  if (candidates.length !== 1) return { delivered: false, reason: "ambiguous_active_runs" };
  const run = candidates[0]!;
  const id = messageId(run, input.kind, body);
  if (run.messages?.some((message) => message.id === id && message.deliveredAt)) return { delivered: true, run };

  const pending: DomainMessage = { id, kind: input.kind, body, at: new Date().toISOString() };
  const withPending: DomainRun = {
    ...run,
    messages: [...(run.messages ?? []).filter((message) => message.id !== id), pending],
    updatedAt: pending.at,
  };
  saveDomainRun(withPending);

  if (input.domain === "coding" && run.transport.kind === "firstmate") {
    try {
      const receipt = await (input.transport ?? new FirstmateDomainTransport()).sendMessage(run, pending);
      const delivered: DomainMessage = { ...pending, deliveredAt: new Date().toISOString(), externalId: receipt.externalId };
      const next = { ...withPending, messages: withPending.messages!.map((message) => message.id === id ? delivered : message), updatedAt: delivered.deliveredAt! };
      saveDomainRun(next);
      return { delivered: true, run: next };
    } catch (error) {
      return { delivered: false, run: withPending, reason: "delivery_failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Native bosses consume durable messages from the DomainRun on their next
  // manager wake. This is still lossless, but is not a live specialist interrupt.
  if (input.domain === "knowledge" && run.owner === "Librarian") {
    const delivered: DomainMessage = { ...pending, deliveredAt: new Date().toISOString() };
    const next = { ...withPending, messages: withPending.messages!.map((message) => message.id === id ? delivered : message), updatedAt: delivered.deliveredAt! };
    saveDomainRun(next);
    return { delivered: true, run: next };
  }

  return { delivered: false, run: withPending, reason: "unsupported_domain" };
}
