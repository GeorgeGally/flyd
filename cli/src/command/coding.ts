import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FirstmateDomainTransport } from "./firstmate.js";
import { recordDomainRunRefusal } from "./store.js";
import type { DomainRequest, DomainRun } from "./types.js";

export type CodingDomainRefusalReason = "project_not_found" | "test_worker";
export type CodingDomainDispatch = { status: "accepted"; run: DomainRun } | { status: "refused"; reason: CodingDomainRefusalReason };

export function guardCodingDomain(projectRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): { projectRoot?: string } | { reason: CodingDomainRefusalReason } {
  if (projectRoot && !existsSync(resolve(projectRoot))) return { reason: "project_not_found" };
  if (env.VITEST || env.JEST_WORKER_ID) return { reason: "test_worker" };
  return projectRoot ? { projectRoot: resolve(projectRoot) } : {};
}

export interface CodingDispatchInput {
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  source?: DomainRequest["source"];
  parentRequestId?: string;
  contextRefs?: string[];
  project?: { name?: string; root?: string };
  transport?: FirstmateDomainTransport;
  skill?: DomainRequest["skill"];
  now?: Date;
}

export async function dispatchCodingDomain(input: CodingDispatchInput): Promise<CodingDomainDispatch> {
  const guarded = guardCodingDomain(input.project?.root);
  if ("reason" in guarded) {
    recordDomainRunRefusal({ at: (input.now ?? new Date()).toISOString(), origin: input.source ?? "system", reason: guarded.reason, ...(input.project?.root ? { projectRoot: resolve(input.project.root) } : {}) });
    return { status: "refused", reason: guarded.reason };
  }
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
    ...(input.project ? { project: { ...input.project, ...(guarded.projectRoot ? { root: guarded.projectRoot } : {}) } } : {}),
    ...(input.skill ? { skill: input.skill } : {}),
  };
  return { status: "accepted", run: await (input.transport ?? new FirstmateDomainTransport()).submit(request) };
}
