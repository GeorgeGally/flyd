import type { IncomingMessage, ServerResponse } from "node:http";
import { attentionEngine } from "./attention-engine.js";
import { commitmentStore } from "./commitment-store.js";
import { extractAndPersistCommitments } from "./commitment-extractor.js";
import { attentionPolicyEngine } from "./attention-policy-engine.js";
import { candidateBuilder } from "./candidate-builder.js";
import { outcomeRecorder } from "./outcome-recorder.js";
import { attentionDispatcher } from "./attention-dispatcher.js";
import type { OutcomeKind } from "./types.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 256 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export async function handleAttentionStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  sendJson(res, 200, attentionEngine.getEngineReport());
}

export async function handleAttentionStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let config;
  try {
    const body = await parseBody(req);
    config = JSON.parse(body);
  } catch {
    config = {};
  }

  attentionEngine.start(config);
  sendJson(res, 200, {
    status: "started",
    shadowMode: attentionEngine.isShadowMode,
  });
}

export async function handleAttentionStop(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  attentionEngine.stop();
  sendJson(res, 200, { status: "stopped" });
}

export async function handleAttentionTick(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const report = await attentionEngine.tick();
  sendJson(res, 200, report);
}

export async function handleAttentionDecisions(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const limit = parseQueryInt(req, "limit", 50);
  const decisions = attentionEngine.getDecisionLog().slice(-limit);
  sendJson(res, 200, { decisions, count: decisions.length });
}

export async function handleAttentionOutcome(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = JSON.parse(await parseBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const candidateId = body.candidateId as string;
  const kind = body.kind as OutcomeKind;

  if (!candidateId || !kind) {
    sendJson(res, 400, { error: "Missing candidateId or kind" });
    return;
  }

  const validKinds = new Set([
    "opened", "dismissed", "snoozed", "acted", "corrected",
    "approved", "rejected", "action_succeeded", "action_failed", "expired_unseen",
  ]);

  if (!validKinds.has(kind)) {
    sendJson(res, 400, { error: `Invalid outcome kind: ${kind}` });
    return;
  }

  const outcome = attentionEngine.recordOutcome(candidateId, kind, {
    correctionText: body.correctionText,
    correctionKind: body.correctionKind,
    resultSummary: body.resultSummary,
  });

  if (!outcome) {
    sendJson(res, 404, { error: "No decision found for candidateId" });
    return;
  }

  sendJson(res, 200, { outcome });
}

export async function handleAttentionCommitments(req: IncomingMessage, res: ServerResponse): Promise<void> {
  switch (req.method) {
    case "GET": {
      const status = parseQueryList(req, "status");
      const kind = parseQueryList(req, "kind");

      const filter: { status?: import("./types.js").CommitmentStatus[]; kind?: import("./types.js").CommitmentKind[] } = {};
      if (status.length > 0) filter.status = status as import("./types.js").CommitmentStatus[];
      if (kind.length > 0) filter.kind = kind as import("./types.js").CommitmentKind[];

      const commitments = commitmentStore.list(filter);
      sendJson(res, 200, { commitments, count: commitments.length });
      return;
    }
    case "POST": {
      let body;
      try {
        body = JSON.parse(await parseBody(req));
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }

      const created = commitmentStore.create({
        kind: body.kind ?? "follow_up",
        title: body.title,
        owner: body.owner,
        beneficiary: body.beneficiary,
        project: body.project,
        dueAt: body.dueAt,
        status: body.status ?? "open",
        consequence: body.consequence,
        confidence: typeof body.confidence === "number" ? body.confidence : 0.7,
        sourceEvidence: body.sourceEvidence ?? [],
      });

      try {
        const { signalBus } = await import("./signal-bus.js");
        signalBus.emit({
          kind: "commitment_stated",
          source: "commitment_ledger",
          subject: created.owner,
          payload: { commitmentId: created.id, title: created.title, kind: created.kind, status: created.status },
          evidence: created.sourceEvidence,
        });
      } catch {
        // signal emission is best-effort
      }

      sendJson(res, 201, { commitment: created });
      return;
    }
    default:
      sendJson(res, 405, { error: "Method not allowed" });
  }
}

export async function handleAttentionCommitmentById(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  switch (req.method) {
    case "GET": {
      const commitment = commitmentStore.get(id);
      if (!commitment) {
        sendJson(res, 404, { error: "Commitment not found" });
        return;
      }
      sendJson(res, 200, { commitment });
      return;
    }
    case "PATCH": {
      let body;
      try {
        body = JSON.parse(await parseBody(req));
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }

      const updated = commitmentStore.update(id, body);
      if (!updated) {
        sendJson(res, 404, { error: "Commitment not found" });
        return;
      }

      try {
        const { signalBus } = await import("./signal-bus.js");
        signalBus.emit({
          kind: "commitment_updated",
          source: "commitment_ledger",
          subject: updated.owner,
          payload: { commitmentId: updated.id, title: updated.title, status: updated.status },
        });
      } catch { /* ok */ }

      sendJson(res, 200, { commitment: updated });
      return;
    }
    case "DELETE": {
      const deleted = commitmentStore.delete(id);
      if (!deleted) {
        sendJson(res, 404, { error: "Commitment not found" });
        return;
      }
      sendJson(res, 200, { deleted: true });
      return;
    }
    default:
      sendJson(res, 405, { error: "Method not allowed" });
  }
}

export async function handleAttentionExtractCommitments(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = JSON.parse(await parseBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (!body.text || typeof body.text !== "string") {
    sendJson(res, 400, { error: "Missing text to extract" });
    return;
  }

  const result = extractAndPersistCommitments(body.text, body.source ?? "api", body.owner, body.project);
  sendJson(res, 200, {
    created: result.created,
    updated: result.updated,
  });
}

export async function handleAttentionSceneClaims(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const claims = attentionDispatcher.getSceneClaims(parseQueryInt(req, "limit", 5));
  sendJson(res, 200, { claims, count: claims.length });
}

export async function handleAttentionPolicy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  switch (req.method) {
    case "GET":
      sendJson(res, 200, attentionPolicyEngine.getConfig());
      return;
    case "PATCH": {
      let body;
      try {
        body = JSON.parse(await parseBody(req));
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }
      attentionPolicyEngine.updateConfig(body);
      attentionPolicyEngine.bumpPolicyVersion("config_update");
      sendJson(res, 200, attentionPolicyEngine.getConfig());
      return;
    }
    default:
      sendJson(res, 405, { error: "Method not allowed" });
  }
}

export async function handleAttentionKill(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = JSON.parse(await parseBody(req));
  } catch {
    body = {};
  }

  if (body.release) {
    attentionEngine.release(
      (body.name as "global" | "source" | "eventClass") ?? "global",
      body.value,
    );
    sendJson(res, 200, { status: "released" });
  } else {
    attentionEngine.kill(
      (body.name as "global" | "source" | "eventClass") ?? "global",
      body.value,
    );
    sendJson(res, 200, { status: "killed" });
  }
}

export async function handleAttentionOutcomes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const stats = outcomeRecorder.getOutcomeStats();
  const outcomes = outcomeRecorder.all.slice(-100);

  sendJson(res, 200, { outcomes, count: outcomes.length, stats });
}

export async function handleAttentionCandidates(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const stats = candidateBuilder.getStats();
  const candidates = candidateBuilder.getAllCandidates();

  sendJson(res, 200, { candidates, count: candidates.length, stats });
}

function parseQueryInt(req: IncomingMessage, key: string, fallback: number): number {
  const url = new URL(req.url ?? "/", "http://localhost");
  const value = url.searchParams.get(key);
  if (value === null) return fallback;
  const num = parseInt(value, 10);
  return isNaN(num) ? fallback : num;
}

function parseQueryList(req: IncomingMessage, key: string): string[] {
  const url = new URL(req.url ?? "/", "http://localhost");
  const values = url.searchParams.getAll(key);
  return values.flatMap((v) => v.split(",")).filter(Boolean);
}
