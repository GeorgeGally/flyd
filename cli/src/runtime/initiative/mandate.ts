import { randomUUID } from "node:crypto";
import type { Project } from "../../council/projects.js";
import { validateEnvelope, type ContextEnvelope } from "../../intelligence/context-envelope.js";
import type { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { INITIATIVE_MANDATE_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import { projectRevision } from "./lineage.js";

const SOURCE = INITIATIVE_MANDATE_CONTRACT.sourceId;
const MAX_TTL_MS = 7 * 86_400_000;

export interface InitiativeResearchMandate {
  mandateId: string;
  sourceEventId: string;
  projectId: string;
  targetRevision: string;
  scope: "read_only_research_followup";
  allowedResult: "local_evidence_report";
  allowedNetwork: "public_scoped_evidence_only";
  issuedAt: string;
  expiresAt: string;
  maxReportsPerDay: 1;
  /** User explicitly ran the acceptance command; never model-generated. */
  acceptedVia: "explicit_cli";
}

function parseMandate(raw: unknown, sourceEventId: string): InitiativeResearchMandate | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<InitiativeResearchMandate>;
  if (typeof data.mandateId !== "string" || typeof data.projectId !== "string"
    || typeof data.targetRevision !== "string" || data.scope !== "read_only_research_followup"
    || data.allowedResult !== "local_evidence_report"
    || data.allowedNetwork !== "public_scoped_evidence_only"
    || data.acceptedVia !== "explicit_cli"
    || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))
    || typeof data.issuedAt !== "string" || !Number.isFinite(Date.parse(data.issuedAt))) return null;
  return { ...data, sourceEventId, maxReportsPerDay: 1 } as InitiativeResearchMandate;
}

export function acceptReadOnlyInitiativeMandate(
  store: IntelligenceEventStore,
  project: Project,
  input: { explicitUserAction: true; now?: Date; ttlMs?: number; registry?: SourceContractRegistry },
): InitiativeResearchMandate {
  if (!input.explicitUserAction) throw new Error("Cannot infer authorization from an initiative or model");
  const registry = input.registry ?? new SourceContractRegistry();
  registry.register(INITIATIVE_MANDATE_CONTRACT);
  if (registry.status(SOURCE) !== "enabled") throw new Error("No enabled explicit read-only mandate source consent");
  if (store.isRevoked(SOURCE)) throw new Error("Mandate source was revoked; explicitly renew first");
  if (project.status === "done" || project.status === "paused" || project.kind === "personal") {
    throw new Error("Only active, nonpersonal projects may receive a read-only initiative remit");
  }
  const now = input.now ?? new Date();
  const ttl = Math.min(MAX_TTL_MS, Math.max(1_000, input.ttlMs ?? MAX_TTL_MS));
  const mandateId = randomUUID();
  const data = {
    mandateId, projectId: project.id, targetRevision: projectRevision(project),
    scope: "read_only_research_followup" as const,
    allowedResult: "local_evidence_report" as const,
    allowedNetwork: "public_scoped_evidence_only" as const,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttl).toISOString(),
    maxReportsPerDay: 1 as const, acceptedVia: "explicit_cli" as const,
  };
  const envelope: ContextEnvelope = {
    pathKind: "interface", kind: "user_confirmed_intention", sourceId: SOURCE,
    consent: { grantedAt: now.toISOString(), scopes: [...INITIATIVE_MANDATE_CONTRACT.scopes] },
    retentionClass: INITIATIVE_MANDATE_CONTRACT.retentionClass,
    payloadClassification: "operational",
    provenance: "explicit_user_cli:initiative-authorize-readonly",
    idempotencyKey: "mandate:" + mandateId,
    correlationId: project.id,
    evidenceRefs: ["project:" + project.id],
    payload: { mandate: data },
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error("Mandate refused: " + validation.detail);
  const event = store.append(envelope);
  if (!event) throw new Error("Could not persist accepted initiative mandate");
  return { ...data, sourceEventId: event.id };
}

export function currentReadOnlyMandate(
  store: IntelligenceEventStore,
  project: Project,
  now = new Date(),
): InitiativeResearchMandate | null {
  if (store.isRevoked(SOURCE) || project.kind === "personal"
    || project.status === "done" || project.status === "paused") return null;
  const events = store.readSourcePage(SOURCE, { limit: 200 });
  for (const event of events) {
    if (event.kind !== "user_confirmed_intention") continue;
    const mandate = parseMandate(event.payload?.mandate, event.id);
    if (!mandate || mandate.projectId !== project.id) continue;
    if (mandate.targetRevision !== projectRevision(project)) continue;
    if (Date.parse(mandate.expiresAt) <= now.getTime()
      || Date.parse(mandate.issuedAt) > now.getTime()) continue;
    return mandate;
  }
  return null;
}
