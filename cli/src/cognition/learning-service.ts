import { randomUUID } from "node:crypto";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { CognitiveCurator } from "./curator/curator.js";
import { runContentLearning } from "./curator/content-learning.js";
import { rebuildKnowledgeProjections } from "./projections/store.js";
import { redactSensitiveText } from "../runtime/context-redactor.js";
import { CORRECTION_SOURCE, IMPORT_SOURCE, correctionCandidates, learningRegistry, recordCorrection } from "../dictation/corrections.js";

export async function learningRequest(path: string, method: string, body: unknown = {}): Promise<{ status: number; body: unknown }> {
  const registry = learningRegistry();
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const store = new IntelligenceEventStore();
  try {
    if (path === "/learning" && method === "GET") return { status: 200, body: {
      sources: registry.list().filter(s => [CORRECTION_SOURCE, IMPORT_SOURCE].includes(s.contract.sourceId)),
      corrections: correctionCandidates(store).slice(-100),
    } };
    if (method !== "POST") return { status: 405, body: { error: "Method not allowed" } };
    if (path === "/learning/source") {
      const source = String(input.sourceId);
      if (![CORRECTION_SOURCE, IMPORT_SOURCE].includes(source)) return { status: 400, body: { error: "Unknown learning source" } };
      const action = input.action;
      if (!["enable", "pause", "disable", "erase"].includes(String(action))) return { status: 400, body: { error: "Unknown action" } };
      if (action === "erase") {
        registry.setStatus(source, "revoked");
        store.eraseSource(source);
        rebuildKnowledgeProjections(store);
      } else {
        if (action === "enable" && registry.status(source) === "revoked") {
          store.renewSource(source);
          registry.renew(source);
        }
        registry.setStatus(source, action === "enable" ? "enabled" : action === "pause" ? "paused" : "disabled");
      }
      return { status: 200, body: { sourceId: source, status: registry.status(source) } };
    }
    if (path === "/dictation/correction") {
      if (registry.status(CORRECTION_SOURCE) !== "enabled") return { status: 403, body: { error: "Correction learning is not enabled" } };
      if (["before", "after", "invocationId", "bundleId", "scope"].some(key => typeof input[key] !== "string"))
        return { status: 400, body: { error: "Missing correction attribution" } };
      const sequence = recordCorrection(input as unknown as Parameters<typeof recordCorrection>[0]);
      return { status: 200, body: { sequence, status: sequence ? "candidate" : "ignored" } };
    }
    if (path === "/dictation/review") {
      if (registry.status(CORRECTION_SOURCE) !== "enabled") return { status: 403, body: { error: "Correction learning is not enabled" } };
      if (!Number.isInteger(input.sequence) || typeof input.approved !== "boolean") return { status: 400, body: { error: "Invalid review" } };
      if (!correctionCandidates(store).some(c => c.sequence === input.sequence)) return { status: 404, body: { error: "Unknown correction" } };
      new CognitiveCurator(store).recordObservation({ review: input.sequence, approved: input.approved, reviewId: randomUUID() }, CORRECTION_SOURCE);
      return { status: 200, body: { reviewed: true } };
    }
    if (path === "/learning/conversations") {
      if (registry.status(IMPORT_SOURCE) !== "enabled") return { status: 403, body: { error: "Conversation import is not enabled" } };
      if (!Array.isArray(input.turns) || input.turns.length < 1 || input.turns.length > 50) return { status: 400, body: { error: "Provide 1–50 attributed turns" } };
      const valid = input.turns.every(t => t && typeof t === "object" && typeof t.sessionId === "string" &&
        typeof t.messageId === "string" && t.sessionId.length <= 200 && t.messageId.length <= 200 &&
        typeof t.user === "string" && t.user.length <= 12000 &&
        (t.assistant === undefined || typeof t.assistant === "string" && t.assistant.length <= 12000) &&
        (t.projectIds === undefined || Array.isArray(t.projectIds) && t.projectIds.length <= 5 &&
          t.projectIds.every((id: unknown) => typeof id === "string" && /^(?:project|event):[a-z0-9._-]{1,100}$/.test(id))));
      if (!valid) return { status: 400, body: { error: "Invalid conversation attribution or scope" } };
      const curator = new CognitiveCurator(store);
      const sequences = input.turns.map(t => curator.recordObservation({ conversation: {
        sessionId: t.sessionId, messageId: t.messageId, user: redactSensitiveText(t.user),
        assistant: redactSensitiveText(t.assistant ?? ""), projectIds: t.projectIds ?? [],
        truncated: t.truncated === true,
      } }, IMPORT_SOURCE, { correlationId: t.sessionId }));
      // A live HTTP request only ingests; the existing background sweep performs learning.
      return { status: 200, body: { sequences, status: "queued" } };
    }
    if (path === "/learning/process") return { status: 200, body: { learned: await runContentLearning({ store }) } };
    return { status: 404, body: { error: "Unknown learning route" } };
  } catch {
    return { status: 409, body: { error: "Learning source is revoked or operation failed" } };
  } finally { store.close(); }
}
