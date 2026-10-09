import { randomUUID } from "node:crypto";
import { FirstmateDomainTransport } from "./firstmate.js";
import type { DomainRequest, DomainRun } from "./types.js";

export interface CodingDispatchInput {
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  source?: DomainRequest["source"];
  parentRequestId?: string;
  contextRefs?: string[];
  project?: { name?: string; root?: string };
  transport?: FirstmateDomainTransport;
  now?: Date;
}

export async function dispatchCodingDomain(input: CodingDispatchInput): Promise<DomainRun> {
  const now = input.now ?? new Date();
  const request: DomainRequest = {
    id: `domain-${randomUUID()}`,
    domain: "coding",
    originalMessage: input.originalMessage.trim() || input.intendedOutcome,
    intendedOutcome: input.intendedOutcome.trim(),
    doneWhen: input.doneWhen,
    createdAt: now.toISOString(),
    ...(input.source ? { source: input.source } : {}),
    ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    ...(input.contextRefs?.length ? { contextRefs: input.contextRefs } : {}),
    ...(input.project ? { project: input.project } : {}),
  };
  return (input.transport ?? new FirstmateDomainTransport()).submit(request);
}
