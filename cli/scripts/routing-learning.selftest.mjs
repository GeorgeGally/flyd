import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Node's native TS runner resolves emitted .js specifiers to source .ts
// when testing directly. No transpiler, provider or worker dependency.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const url = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
    throw error;
  }
} });
process.env.VITEST = "1"; // Production network/default capture remains off.
const learning = await import("../src/runtime/routing-learning.ts");
const { routeMessage, deskOwnerFor } = await import("../src/conversation-view/flyd-desk.ts");
const { routeWithJev, planTurn, offRoute } = await import("../src/runtime/turn-plan.ts");
const { predicateThreshold } = await import("../src/cognition/system-one/registry.ts");
const { persistTurnReceipt } = await import("../src/runtime/turn-receipt.ts");
const { parseRoom } = await import("../src/runtime/read-the-room.ts");
let root;
const originalFetch = globalThis.fetch;
const originalKey = process.env.TYPESAFE_API_KEY;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "flyd-routing-")); delete process.env.TYPESAFE_API_KEY; });
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = originalKey;
});
const now = new Date("2026-10-10T00:00:00Z");
function sessionFor(split) {
  for (let i = 0; ; i++) if (learning.routingSplit("session-" + i) === split) return "session-" + i;
}
function entry(id, overrides = {}) {
  return learning.collectRoutingCase(root, id, {
    version: 1, surface: "runtime", at: now.toISOString(), sessionId: sessionFor("development"),
    input: { message: "Explain this", conversation_recap: "Flyd: want an explanation?" },
    contextComplete: true, policyVersion: "p1", observed: { route: "answer" }, source: "jev", confidence: 0.99,
    ...overrides,
  });
}
const judge = (route, ambiguous = false) => async () => JSON.stringify({ expected: { route, domain: "general" }, reason: "Explicit request", ambiguous });
const fast = (overrides = {}) => ({ route: "answer", source: "jev", confidence: 0.99, decided: true, needsCode: false, ...overrides });

test("collection preserves original evidence and session split on reimport", () => {
  const a = entry("r1");
  const b = entry("r1", { observed: { route: "act" } });
  assert.deepEqual(b, a);
  assert.equal(entry("r2").split, a.split);
  assert.equal(learning.routingCases(root).length, 2);
  assert.equal(statSync(join(root, "routing", "cases", a.id + ".json")).mode & 0o777, 0o600);
});
test("private evidence redacts bearer tokens and credential fields", () => {
  const a = entry("r1", { input: { message: "Bearer abc123 api_key=secret", password: "secret", nested: { apiKey: "hidden" } } });
  const text = JSON.stringify(a);
  assert.ok(!text.includes("abc123")); assert.ok(!text.includes('"hidden"'));
  assert.match(text, /REDACTED_SECRET/);
});
test("blind label prompt excludes incumbent, confidence and later outcome", () => {
  const a = entry("r1", { observed: { route: "delegate" }, confidence: 0.987654, source: "unique-source" });
  const prompt = learning.routingLabelPrompt(a);
  assert.ok(!prompt.includes("0.987654")); assert.ok(!prompt.includes("unique-source"));
  assert.ok(!prompt.includes('"observed"'));
});
test("invalid and unreviewed labels cannot vote in accuracy or improvement evidence", async () => {
  const a = entry("r1");
  await learning.runRoutingAudit({ root, now, judge: judge("act"), judgeModel: "judge" });
  assert.equal(learning.routingProposals(root).length, 1);
  assert.equal(learning.evaluateRouting(root).accuracy, null);
  assert.deepEqual(learning.routingFailureEvidence(root), []);
  assert.throws(() => learning.reviewRoutingCase(root, a.id, { route: "wrong" }, "why", "George"));
});
test("explicit reviewed corrections become evidence; later review preserves history", () => {
  const a = entry("r1");
  learning.reviewRoutingCase(root, a.id, { route: "act" }, "I asked for action", "George", now);
  assert.equal(learning.routingFailureEvidence(root).length, 1);
  assert.equal(learning.evaluateRouting(root).accuracy, 0);
  learning.reviewRoutingCase(root, a.id, { route: "answer" }, "Actually discussion", "George", now);
  assert.equal(learning.routingFailureEvidence(root).length, 0);
  assert.equal(readdirSync(join(root, "routing", "label-history")).length, 1);
});
test("unknown owner/domain evidence remains unscored, never a manufactured mistake", () => {
  const a = entry("r1", { observed: { route: "delegate" } });
  learning.reviewRoutingCase(root, a.id, { route: "delegate", domain: "coding" }, "Code work", "George", now);
  assert.equal(learning.evaluateRouting(root).reviewed, 0);
  assert.equal(learning.routingFailureEvidence(root).length, 0);
});
test("daily audit samples confident successes and does not require complaints", async () => {
  entry("r1");
  const report = await learning.runRoutingAudit({ root, now, judge: judge("answer") });
  assert.equal(report.proposals, 1);
  const again = await learning.runRoutingAudit({ root, now: new Date(now.getTime() + 1000), judge: judge("answer") });
  assert.equal(again.status, "not_due");
});
test("unattended audit never sends sealed test or validation cases to judge", async () => {
  entry("dev");
  entry("sealed", { sessionId: sessionFor("test") });
  entry("validation", { sessionId: sessionFor("validation") });
  let calls = 0;
  await learning.runRoutingAudit({ root, now, judge: async () => { calls++; return judge("answer")(); } });
  assert.equal(calls, 1);
});
test("incomplete historical context is excluded from automated labelling", async () => {
  entry("old", { contextComplete: false });
  const report = await learning.runRoutingAudit({ root, now, judge: () => { throw Error("must not call"); } });
  assert.equal(report.proposals, 0); assert.deepEqual(report.errors, []);
});
test("weekly judge disagreement challenges but never overwrites reviewed truth", async () => {
  const a = entry("r1");
  learning.reviewRoutingCase(root, a.id, { route: "answer" }, "Explain", "George", now);
  const report = await learning.runRoutingAudit({ root, now, judge: judge("act") });
  assert.deepEqual(report.challenged, [a.id]);
  assert.equal(learning.routingLabels(root)[0].expected.route, "answer");
  assert.equal(learning.routingFailureEvidence(root).length, 0);
});
test("weekly replay retests a reviewed assumption even with no fresh evidence", async () => {
  const a = entry("r1");
  learning.reviewRoutingCase(root, a.id, { route: "answer" }, "Explain", "George", now);
  let calls = 0;
  const replay = async () => { calls++; return { route: "act" }; };
  await learning.runRoutingAudit({ root, now, replay });
  await learning.runRoutingAudit({ root, now: new Date(now.getTime() + 86_400_000), replay });
  assert.equal(calls, 1);
  await learning.runRoutingAudit({ root, now: new Date(now.getTime() + 7 * 86_400_000), replay });
  assert.equal(calls, 2); assert.equal(learning.routingFailureEvidence(root).length, 2);
});
test("failed judge output stays unlabelled and can be retried tomorrow", async () => {
  entry("r1");
  const report = await learning.runRoutingAudit({ root, now, judge: async () => "not JSON" });
  assert.equal(report.errors.length, 1); assert.equal(learning.routingProposals(root).length, 0);
  const retry = await learning.runRoutingAudit({ root, now: new Date(now.getTime() + 86_400_000), judge: judge("answer") });
  assert.equal(retry.proposals, 1);
});
test("receipt importer skips latest aliases and never invents historical context", () => {
  mkdirSync(join(root, "turn-receipts", "s1"), { recursive: true });
  const receipt = { id: "r1", recordedAt: now.toISOString(), sessionId: "s1", message: "yes", plan: { route: "act" } };
  for (const name of ["1-r1.json", "latest.json"]) writeFileSync(join(root, "turn-receipts", "s1", name), JSON.stringify(receipt));
  assert.deepEqual(learning.importRoutingReceipts(root), { imported: 1, incomplete: 1 });
  assert.deepEqual(learning.importRoutingReceipts(root), { imported: 0, incomplete: 0 });
  assert.equal(learning.routingCases(root)[0].trace.contextComplete, false);
});
test("turn receipts collect live evidence without changing the receipt contract", async () => {
  const a = entry("source");
  const receipt = await persistTurnReceipt({ sessionId: "s1", turnNumber: 1, route: "conversation", message: "hello", model: "m",
    providerIdentity: "p", memory: {}, toolCalls: [], answer: "hi", status: "succeeded", routing: a.trace },
    { flydDir: root, id: () => "live" });
  assert.equal(receipt.version, 1);
  assert.equal(learning.routingCases(root).length, 2);
});
test("candidate scoring excludes missing predictions and reports denominators", () => {
  const a = entry("one", { candidate: { route: "act" } }), b = entry("two");
  for (const e of [a, b]) learning.reviewRoutingCase(root, e.id, { route: "answer" }, "Explain", "George", now);
  const report = learning.evaluateRouting(root, "candidate");
  assert.equal(report.total, 2); assert.equal(report.reviewed, 1); assert.equal(report.unscored, 1);
  assert.equal(report.accuracy, 0); assert.equal(report.latencyMs.p50, null);
});
test("named model benchmark predictions are distinct from labels", () => {
  const a = entry("one");
  learning.recordRoutingPrediction(root, { caseId: a.id, arm: "luna", decision: { route: "answer" }, model: "luna-id", policyVersion: "p", latencyMs: 20, at: now.toISOString() });
  assert.equal(learning.evaluateRouting(root, "luna").accuracy, null);
  learning.reviewRoutingCase(root, a.id, { route: "answer" }, "Explain", "George", now);
  assert.equal(learning.evaluateRouting(root, "luna").accuracy, 1);
  assert.equal(learning.evaluateRouting(root, "luna").latencyMs.p50, 20);
});
test("route confidence cannot compensate for unknown delegation ownership", () => {
  assert.equal(deskOwnerFor(fast({ route: "delegate", domain: null })), null);
  assert.equal(deskOwnerFor(fast({ route: "delegate", domain: "coding" })), "firstmate");
  assert.equal(deskOwnerFor(fast({ needsCode: true })), "firstmate");
  assert.equal(deskOwnerFor(fast({ needsCode: null })), null);
});
test("shadow routing records comparison while incumbent alone chooses dispatch", async () => {
  const traces = [];
  const result = await routeMessage({ text: "explain", recent: [], images: 0, sessionId: "s1" }, async () => "FLYD", 100,
    { mode: "shadow", predict: async () => fast({ route: "delegate", domain: "coding", needsCode: true }), collect: (t) => traces.push(t) });
  await Promise.resolve();
  assert.equal(result, "flyd"); assert.equal(traces[0].candidate.owner, "firstmate");
});
test("live confident Jev skips fallback; uncertain ownership invokes it once", async () => {
  let calls = 0;
  const complete = async () => { calls++; return "FLYD"; };
  const input = { text: "implement it", recent: [], images: 0 };
  assert.equal(await routeMessage(input, complete, 100, { mode: "live", predict: async () => fast({ needsCode: true }) }), "firstmate");
  assert.equal(calls, 0);
  assert.equal(await routeMessage(input, complete, 100, { mode: "live", predict: async () => fast({ decided: false }) }), "flyd");
  assert.equal(calls, 1);
});
test("explicit commands and screenshots never invoke the classifiers", async () => {
  const forbidden = async () => { throw Error("called"); };
  for (const input of [{ text: "/review", command: "review", images: 0, recent: [] }, { text: "look", images: 1, recent: [] }]) {
    assert.equal(await routeMessage(input, forbidden, 10, { mode: "live", predict: forbidden }), "firstmate");
  }
});
test("live fallback failure goes to Flyd rather than manufacturing a coding request", async () => {
  const result = await routeMessage({ text: "yes", images: 0, recent: [] }, async () => { throw Error("offline"); }, 10,
    { mode: "live", predict: async () => null });
  assert.equal(result, "flyd");
});
test("collector failure cannot fail routing", async () => {
  assert.equal(await routeMessage({ text: "hello", images: 0, recent: [] }, async () => "FLYD", 10,
    { mode: "off", collect: () => { throw Error("disk full"); } }), "flyd");
  await Promise.resolve();
});
test("actual Jev client retains the exact redacted state and rejects uncertain domain", async () => {
  process.env.TYPESAFE_API_KEY = "test-only";
  let sent;
  globalThis.fetch = async (_url, request) => {
    sent = JSON.parse(request.body);
    return { ok: true, json: async () => ({ model: "jev-test", answers: {
      chat_turn_route: { choice: "delegate", confidence: 0.99, probabilities: { delegate: 0.99 } },
      chat_turn_domain: { choice: "coding", confidence: 0.2, probabilities: { coding: 0.5 } },
    } }) };
  };
  const reading = await routeWithJev("Fix it with sk-abcdefghijklmno", [{ role: "assistant", content: "Want me to fix the code?" }]);
  assert.equal(reading.decided, false);
  assert.equal(reading.domain, null);
  assert.deepEqual(reading.evidence.input, sent.state);
  assert.ok(!JSON.stringify(reading.evidence).includes("sk-abcdefghijklmno"));
});
test("same short reply carries the preceding offer into the actual Jev request", async () => {
  process.env.TYPESAFE_API_KEY = "test-only";
  globalThis.fetch = async (_url, request) => {
    const state = JSON.parse(request.body).state;
    const route = state.conversation_recap.includes("fix the code") ? "delegate" : "answer";
    return { ok: true, json: async () => ({ model: "test", answers: {
      chat_turn_route: { choice: route, confidence: 0.99 },
      chat_turn_domain: { choice: route === "delegate" ? "coding" : "general", confidence: 0.99 },
    } }) };
  };
  const work = await routeWithJev("yes", [{ role: "assistant", content: "Shall I fix the code?" }]);
  const chat = await routeWithJev("yes", [{ role: "assistant", content: "Want an explanation?" }]);
  assert.equal(work.route, "delegate"); assert.equal(chat.route, "answer");
});
test("failed Jev call retains error evidence and abstains", async () => {
  process.env.TYPESAFE_API_KEY = "test-only";
  globalThis.fetch = async () => { throw Error("offline"); };
  const reading = await routeWithJev("do it");
  assert.equal(reading.decided, false); assert.equal(reading.route, "clarify");
  assert.match(reading.evidence.judgments.error, /offline/);
});
test("harness still blocks mutation on answer/clarify routes", () => {
  for (const route of ["answer", "clarify"]) {
    const plan = planTurn({ route, source: "llm" });
    assert.ok(offRoute(plan, "write_file", { path: "x", content: "x" }));
  }
});
test("live malformed output and fallback timeout cannot become Firstmate work", async () => {
  const input = { text: "yes", images: 0, recent: [] };
  const options = { mode: "live", predict: async () => null };
  assert.equal(await routeMessage(input, async () => "maybe", 10, options), "flyd");
  assert.equal(await routeMessage(input, () => new Promise(() => {}), 10, options), "flyd");
});
test("concurrent audits share a lock and do not run the judge twice", async () => {
  entry("one");
  let release;
  const first = learning.runRoutingAudit({ root, now, judge: () => new Promise((r) => { release = r; }) });
  const second = await learning.runRoutingAudit({ root, now, force: true, judge: judge("answer") });
  assert.equal(second.status, "already_running");
  release(await judge("answer")());
  await first;
  assert.ok(!existsSync(join(root, "routing", "audits", "running")));
});
test("a malformed room-reader action does not establish authority", () => {
  const input = { knowledge: [], notes: [] };
  assert.equal(parseRoom('{"need":"do","route":"yolo","stance":"Do it"}', input).route, "clarify");
  assert.equal(parseRoom('{"need":"do","stance":"Do it"}', input).route, "clarify");
  assert.equal(parseRoom('{"need":"do","route":"act","stance":"Do it"}', input).route, "act");
});
test("sealed holdout mistakes cannot leak into self-improvement evidence or nightly scores", async () => {
  const a = entry("sealed", { sessionId: sessionFor("test") });
  learning.reviewRoutingCase(root, a.id, { route: "act" }, "Different intent", "George", now);
  assert.equal(learning.evaluateRouting(root, "observed", "test").accuracy, 0);
  assert.deepEqual(learning.routingFailureEvidence(root), []);
  const report = await learning.runRoutingAudit({ root, now });
  assert.equal(report.evaluation.total, 0);
});
