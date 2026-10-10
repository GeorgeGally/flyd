import { FLYD_DIR } from "../lib/config.js";
import { evaluatePredicates, JEV_PINNED_MODEL } from "../cognition/system-one/jev.js";
import { familyEgress, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import { EgressPolicyGateway } from "../intelligence/egress-policy-gateway.js";
import { runRoutingAudit, routingHash, type RoutingCase, type RoutingDecision } from "./routing-learning.js";

/** Same registry/client as production, but no tools, managers or dispatch. */
export async function replayRoutingCase(entry: RoutingCase): Promise<RoutingDecision> {
  const input = entry.trace.input;
  const state = {
    utterance: input.utterance ?? input.message ?? input.text,
    conversation_recap: input.conversation_recap ?? "",
  };
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("Jev is not configured");
  const ids = ["chat_turn_route", "chat_turn_domain", "chat_turn_needs_code"];
  const result = await evaluatePredicates(state, ids.map((id) => questionFor(id)),
    { apiKey, model: process.env.FLYD_JEV_MODEL ?? JEV_PINNED_MODEL, timeoutMs: 3_000 }, familyEgress("chat"));
  const route = result.answers.chat_turn_route;
  const domain = result.answers.chat_turn_domain;
  if (!result.ok || !route?.choice || route.confidence < predicateThreshold("chat_turn_route")) throw new Error("Replay abstained");
  const owned = domain?.choice && domain.confidence >= predicateThreshold("chat_turn_domain") ? domain.choice : null;
  if (route.choice === "delegate" && (!owned || owned === "general")) throw new Error("Replay owner abstained");
  if (entry.trace.surface === "desk") {
    const code = result.answers.chat_turn_needs_code?.probability;
    if (code === undefined || (code > 1 - predicateThreshold("chat_turn_needs_code") && code < predicateThreshold("chat_turn_needs_code"))) throw new Error("Replay code need abstained");
    return { owner: code >= predicateThreshold("chat_turn_needs_code") || (route.choice === "delegate" && owned === "coding") ? "firstmate" : "flyd" };
  }
  return { route: route.choice as RoutingDecision["route"], ...(owned ? { domain: owned as RoutingDecision["domain"] } : {}) };
}

/** Explicitly configured judge only; no surprise default-model egress. */
export async function defaultRoutingJudge(prompt: string): Promise<string> {
  const model = process.env.FLYD_ROUTING_JUDGE_MODEL?.trim();
  if (!model) throw new Error("Set FLYD_ROUTING_JUDGE_MODEL to the exact judge model ID");
  const hash = routingHash(prompt);
  const receipt = new EgressPolicyGateway({ isRevoked: () => false }).check({
    pathKind: "interface", kind: "inferred_belief", sourceId: "routing.audit",
    consent: { grantedAt: new Date(0).toISOString(), scopes: [] }, retentionClass: "ephemeral",
    payloadClassification: "personal", provenance: "flyd.routing.audit", idempotencyKey: hash,
  }, {
    destination: "model:" + model, purpose: "routing.audit", fields: ["prompt"], payload: { prompt },
    schema: { allowedFields: ["prompt"], maxPayloadBytes: 64 * 1024 },
  });
  if (!receipt.allowed || !receipt.outboundPayload) throw new Error("Routing judge egress denied");
  const { query } = await import("../lib/llm.js");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      query(String(receipt.outboundPayload.prompt), model, undefined, undefined, undefined, { json: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Routing judge timed out")), 12_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
export async function auditRouting(root = FLYD_DIR, force = false) {
  return runRoutingAudit({
    root, force,
    ...(process.env.FLYD_ROUTING_JUDGE_MODEL ? { judge: defaultRoutingJudge, judgeModel: process.env.FLYD_ROUTING_JUDGE_MODEL } : {}),
    ...(process.env.TYPESAFE_API_KEY ? { replay: replayRoutingCase } : {}),
  });
}
