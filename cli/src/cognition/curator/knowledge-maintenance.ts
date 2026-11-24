import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { IntelligenceEventStore, type StoredEvent } from "../../intelligence/event-store.js";
import { validateEnvelope } from "../../intelligence/context-envelope.js";
import { redactSensitiveText } from "../../runtime/context-redactor.js";
import { acceptKnowledgeProposal, repairMode, targetRevision, type FactKey, type KnowledgeProposal } from "./knowledge-repair.js";
import { runKnownFactMigration } from "./knowledge-migration.js";
import { knowledgeSourceAllowed } from "./knowledge-source-policy.js";

export type KnowledgeSource = { kind: "event"; sequence: number } | { kind: "repository"; root: string; path: string } | { kind: "research" };
export interface KnowledgeIssue {
  id: string;
  originSequence: number;
  question: string;
  key?: FactKey;
  source: KnowledgeSource;
  evidenceSequences: number[];
  expectedRevision?: string;
  priority: number;
  state: "queued" | "investigating" | "ready" | "applied" | "deferred" | "rejected";
  attempts: number;
  dueAt: string;
  runId?: string;
  revision: number;
  reason?: string;
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

function write(store: IntelligenceEventStore, issue: Omit<KnowledgeIssue, "revision">): KnowledgeIssue {
  const origin = store.getBySequence(issue.originSequence);
  if (!origin || !knowledgeSourceAllowed(store,origin)) throw new Error("Issue source is unavailable");
  const envelope = {
    pathKind: "executive" as const, kind: "observation" as const, sourceId: origin.sourceId,
    consent: JSON.parse(origin.consentJson), retentionClass: origin.retentionClass as "local_default",
    payloadClassification: "personal" as const, provenance: "knowledge-maintenance:v1",
    idempotencyKey: `issue:${issue.id}:${hash(issue)}`, evidenceRefs: [`event:${origin.sequence}`],
    payload: { recordType: "knowledge.issue", issue },
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error(validation.detail);
  const event = store.append(envelope)!;
  return { ...issue, revision: event.sequence };
}

export function knowledgeIssues(store: IntelligenceEventStore): KnowledgeIssue[] {
  const issues = new Map<string, KnowledgeIssue>();
  for (const event of store.readRecords("knowledge.issue")) {
    const issue = event.payload?.issue as Omit<KnowledgeIssue, "revision">;
    const origin=issue?.id ? store.getBySequence(issue.originSequence) : null;
    if (issue?.id && origin && knowledgeSourceAllowed(store,origin) && !store.isRevoked(event.sourceId)) issues.set(issue.id, { ...issue, revision: event.sequence });
  }
  return [...issues.values()];
}

export function enqueueKnowledgeIssue(store: IntelligenceEventStore, input: { originSequence: number; question: string; key?: FactKey; source: KnowledgeSource; priority?: number }): KnowledgeIssue {
  if (!input.question.trim() || input.question.length > 2000) throw new Error("Invalid bounded knowledge issue");
  const id = hash([input.originSequence, input.question, input.key, input.source]);
  const existing = knowledgeIssues(store).find((i) => i.id === id);
  if (existing) return existing;
  return write(store, { ...input, id, priority: input.priority ?? 0, attempts: 0, state: "queued", dueAt: new Date(0).toISOString(), evidenceSequences: [], ...(input.key ? { expectedRevision: targetRevision(store, input.key) } : {}) });
}

export function readyKnowledgeIssues(store: IntelligenceEventStore): KnowledgeIssue[] { return knowledgeIssues(store).filter((issue) => issue.state === "ready"); }

export function knowledgeIssuePrompt(store: IntelligenceEventStore): string {
  return readyKnowledgeIssues(store).filter((issue) => {
    const origin=store.getBySequence(issue.originSequence);
    return origin && knowledgeSourceAllowed(store,origin,true) && issue.evidenceSequences.every((sequence)=>{const event=store.getBySequence(sequence);return event && knowledgeSourceAllowed(store,event,true);});
  }).slice(0, 5).map((issue) => JSON.stringify({ issueId: issue.id, question: issue.question, key: issue.key, evidence: issue.evidenceSequences.map((sequence) => ({ sequence, text: (store.getBySequence(sequence)?.payload?.sourceEvidence as { text?: string })?.text ?? "" })) })).join("\n");
}

/** Model output cannot change issue identity/scope, claim user confirmation or replace facts from a worker allegation. */
export function applyKnowledgeAnswers(store: IntelligenceEventStore, answers: unknown[]): string[] {
  const results: string[] = [];
  const pending = readyKnowledgeIssues(store).slice(0,5);
  for (const raw of answers.slice(0, 5)) {
    try {
      if (!raw || typeof raw !== "object") continue;
      const answer = raw as { issueId: string; value: string; sequence: number; quote: string };
      const issue = readyKnowledgeIssues(store).find((i) => i.id === answer.issueId);
      if (!issue?.key || !issue.evidenceSequences.includes(answer.sequence) || typeof answer.value !== "string" || typeof answer.quote !== "string") throw new Error("Unattributed knowledge answer");
      const proposal: KnowledgeProposal = { originId: issue.id, key: issue.key, value: answer.value, operation: "dispute", expectedRevision: issue.expectedRevision!, evidence: [{ sequence: answer.sequence, quote: answer.quote }], authority: "inferred" };
      const receipt = acceptKnowledgeProposal(store, proposal);
      write(store, { ...issue, state: "applied", reason: receipt.repairId });
      results.push(receipt.repairId);
    } catch { /* Keep the issue/evidence for bounded retry or inspection, never fall back to a file edit. */ }
  }
  for (const issue of pending) {
    const latest = knowledgeIssues(store).find((i) => i.id === issue.id);
    if (latest?.state === "ready") write(store, { ...latest, attempts: latest.attempts+1, state: latest.attempts >= 2 ? "deferred" : "ready", reason: "No grounded answer accepted" });
  }
  return results;
}

export interface MaintenanceDependencies {
  read?: (source: KnowledgeSource, store: IntelligenceEventStore) => Promise<{ text: string; locator: string; revision?: string }>;
  dispatch?: (id: string, question: string) => string;
  report?: (id: string) => { finished: boolean; text: string } | null;
}

async function readSource(source: KnowledgeSource, store: IntelligenceEventStore): Promise<{ text: string; locator: string; revision?: string }> {
  if (source.kind === "event") {
    const event = store.getBySequence(source.sequence);
    if (!event?.payload || !knowledgeSourceAllowed(store,event)) throw new Error("Source revoked, paused or erased");
    const conversation = event.payload.conversation as { user?: string } | undefined;
    const evidence = event.payload.sourceEvidence as { text?: string } | undefined;
    const text = evidence?.text ?? conversation?.user;
    if (!text) throw new Error("Original source text is unavailable");
    return { text, locator: `event:${source.sequence}` };
  }
  if (source.kind !== "repository") throw new Error("Needs knowledge domain");
  const { refreshRepoRegistry } = await import("../../runtime/repo-registry.js");
  const repos = await refreshRepoRegistry();
  if (!repos.some((r) => r.root === source.root) || !/^[\w./-]+$/.test(source.path) || source.path.startsWith("/") || source.path.split("/").includes("..")) throw new Error("Repository source is outside known scope");
  const options = { encoding: "utf8" as const, timeout: 10000, maxBuffer: 1024 * 1024 };
  const revision = execFileSync("git", ["-C", source.root, "rev-parse", "HEAD"], options).trim();
  const text = execFileSync("git", ["-C", source.root, "show", `${revision}:${source.path}`], options);
  return { text, revision, locator: `${source.root}@${revision}:${source.path}` };
}

let active: Promise<number> | undefined;
export function runKnowledgeMaintenance(options: { store?: IntelligenceEventStore; now?: Date; deps?: MaintenanceDependencies } = {}): Promise<number> {
  if (repairMode() === "off") return Promise.resolve(0);
  if (!options.store && active) return active;
  const run = async () => {
    const store = options.store ?? new IntelligenceEventStore();
    const now = options.now ?? new Date();
    let processed = 0;
    try {
      processed += runKnownFactMigration(store);
      const due = knowledgeIssues(store).filter((i) => ["queued", "investigating"].includes(i.state) && Date.parse(i.dueAt) <= now.getTime()).sort((a,b) => b.priority-a.priority).slice(0,5);
      for (const candidate of due) {
        const issue = store.transaction(() => {
          const latest = knowledgeIssues(store).find((i) => i.id === candidate.id);
          if (!latest || latest.revision !== candidate.revision) return null;
          return write(store, { ...latest, state: "investigating", attempts: latest.attempts + 1, dueAt: new Date(now.getTime()+300000).toISOString() });
        });
        if (!issue) continue;
        try {
          let evidence: { text: string; locator: string; revision?: string };
          if (issue.source.kind === "research") {
            const origin=store.getBySequence(issue.originSequence);
            if (!origin || !knowledgeSourceAllowed(store,origin,true)) throw new Error("Source does not permit research-model egress");
            const runId = issue.runId ?? `domain-knowledge-${issue.id}`;
            const { dispatchKnowledgeDomain } = await import("../../command/librarian.js");
            const { readDomainRun } = await import("../../command/store.js");
            const report = options.deps?.report?.(runId) ?? (() => {
              const run = readDomainRun(runId);
              return run ? { finished: ["completed", "failed", "cancelled"].includes(run.status), text: run.result?.detailedReport ?? run.result?.brief ?? "" } : null;
            })();
            if (!report) {
              if (process.env.VITEST && !options.deps?.dispatch) throw new Error("Tests require a fake knowledge dispatcher");
              if (knowledgeIssues(store).some((i) => i.id !== issue.id && i.source.kind === "research" && i.state === "investigating")) {
                write(store, { ...issue, state: "queued", attempts: Math.max(0,issue.attempts-1), reason: "Waiting for active investigation" });
                continue;
              }
              if (options.deps?.dispatch) options.deps.dispatch(runId, issue.question);
              else dispatchKnowledgeDomain({ requestId: runId, intendedOutcome: issue.question, originalMessage: issue.question, background: true, doneWhen: ["Reopen original sources, retain locators and dates, and preserve unresolved disagreements"] });
              write(store, { ...issue, runId });
              continue;
            }
            if (!report.finished) { write(store, { ...issue, runId, attempts: Math.max(0, issue.attempts-1) }); continue; }
            evidence = { text: report.text, locator: `domain:${runId}` };
          } else evidence = await (options.deps?.read ?? readSource)(issue.source, store);
          store.transaction(() => {
            const origin = store.getBySequence(issue.originSequence);
            if (!origin?.payload || !knowledgeSourceAllowed(store,origin)) throw new Error("Issue source is no longer permitted");
            if (issue.source.kind === "event") {
              const original = store.getBySequence(issue.source.sequence);
              if (!original || !knowledgeSourceAllowed(store,original)) throw new Error("Original source changed or was erased during recheck");
            }
            const envelope = { pathKind: "executive" as const, kind: "observation" as const, sourceId: origin.sourceId,
              consent: JSON.parse(origin.consentJson), retentionClass: origin.retentionClass as "local_default", payloadClassification: "personal" as const,
              provenance: "knowledge-source:v1", idempotencyKey: `source:${issue.id}:${hash(evidence)}`, evidenceRefs: [`event:${origin.sequence}`, ...(issue.source.kind === "event" ? [`event:${issue.source.sequence}`] : [])],
              payload: { recordType: "knowledge.source", sourceEvidence: { ...evidence, text: redactSensitiveText(evidence.text).slice(0,8000), fetchedAt: now.toISOString() } },
            };
            const validation = validateEnvelope(envelope, { consentLookup: store });
            if (!validation.ok) throw new Error(validation.detail);
            const observation = store.append(envelope)!;
            write(store, { ...issue, state: "ready", evidenceSequences: [observation.sequence] });
          });
          processed++;
        } catch (error) {
          const stillLive = store.getBySequence(issue.originSequence);
          if (stillLive && knowledgeSourceAllowed(store,stillLive)) write(store, { ...issue, state: issue.attempts >= 2 ? "deferred" : "queued", reason: (error instanceof Error ? error.message : "Source unavailable").slice(0,200) });
        }
      }
      return processed;
    } finally { if (!options.store) store.close(); }
  };
  const result = run();
  if (!options.store) { active = result; void result.finally(() => { active = undefined; }).catch(() => {}); }
  return result;
}
