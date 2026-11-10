import { join } from "node:path";
import type { DomainMessage, DomainResult, DomainRun } from "../../command/types.js";
import type { DeliveryCase, DeliveryObservation, DeliveryShape } from "./delivery-scoring.js";

// Today's delivery paths, driven with one case each, so the baseline measures
// what George is actually shown. Split-plan Phase 1 swaps the notification and
// window producers for `deliver(reportFromRun(run))` and reruns the same cases.
// Call only inside the delivery suite's sandbox: these paths write state.

export type Complete = (prompt: string) => Promise<string>;

const EMPTY_RESULT: DomainResult = {
  format: "structured", brief: "", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [],
  evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low",
};

const OWNERS: Record<DomainRun["request"]["domain"], string> = { coding: "firstmate", knowledge: "librarian", creative: "design-mate", life: "flyd" };

/** The case's run as the command store would hold it, asked from chat. */
export async function runFor(testCase: DeliveryCase, now = new Date()): Promise<DomainRun> {
  const fixture = testCase.run;
  if (!fixture) throw new Error(`${testCase.id}: a notification case needs a run`);
  const at = now.toISOString();
  const id = `domain-eval-${testCase.id}`;
  const { HANDLE_IT_YOURSELF, RECOVER_IT_YOURSELF, RESTATE_FOR_GEORGE } = await import("../../intelligence/executive/decision-step.js");
  // Flyd's one send-back already spent, as on the real runs: the review step decides for George now.
  const messages: DomainMessage[] = fixture.sentToBoss
    ? [HANDLE_IT_YOURSELF, RECOVER_IT_YOURSELF, RESTATE_FOR_GEORGE].map((body, index) => ({ id: `${id}-note-${index}`, kind: "question", body, from: "flyd", at, deliveredAt: at }))
    : [];
  return {
    id,
    request: { id: `request-${id}`, domain: fixture.domain, originalMessage: fixture.words, intendedOutcome: fixture.outcome ?? fixture.words, doneWhen: [], createdAt: at, source: "chat" },
    owner: OWNERS[fixture.domain],
    status: fixture.status,
    createdAt: at,
    updatedAt: at,
    transport: { kind: fixture.domain === "coding" ? "firstmate" : "native", requestId: id },
    ...(messages.length ? { messages } : {}),
    result: { ...EMPTY_RESULT, ...fixture.result },
  };
}

/** A finished run through today's review step to his notification; a sent-back note reaches the boss, never him. */
async function notification(testCase: DeliveryCase): Promise<Pick<DeliveryObservation, "text" | "shape">> {
  const { notifyRun, decideRun } = await import("../../command/scheduler.js");
  const { quickQuery } = await import("../../lib/llm.js");
  const run = await runFor(testCase);
  const { saveDomainRun } = await import("../../command/store.js");
  saveDomainRun(run);
  const { deliver, reportFromRun } = await import("../../runtime/delivery.js");
  let said: { text: string; kind?: string } | null = null;
  let decided: Awaited<ReturnType<typeof decideRun>> | null = null;
  await notifyRun(
    run,
    async (_title, message, kind) => { said = { text: message, ...(kind ? { kind } : {}) }; },
    async ({ run: target, kind, body, from }) => {
      const at = new Date().toISOString();
      return { delivered: true, run: { ...target, messages: [...(target.messages ?? []), { id: `${target.id}-${(target.messages?.length ?? 0) + 1}`, kind, body, ...(from ? { from } : {}), at, deliveredAt: at }] } };
    },
    async (target, send) => (decided = await decideRun(target, send, (prompt) => quickQuery(prompt, { json: true }))),
  );
  const told = said as { text: string; kind?: string } | null;
  // The notification is the lead line; the shape is what tapping it opens.
  return { text: told?.text ?? null, shape: told ? deliver(reportFromRun(run, decided), "notification").shape : "words" };
}

/** A staff reply under his message: Flyd's reading of it, or today's fallback when the reading is refused. */
async function window(testCase: DeliveryCase, complete: Complete, sandbox: string): Promise<Pick<DeliveryObservation, "text" | "shape">> {
  const reply = testCase.reply;
  if (!reply) throw new Error(`${testCase.id}: a window case needs a reply`);
  const [{ AnswerInterpreter }, { inFlydsVoice }, { screenOutgoing }, { condense }, { stripCommitIds }] = await Promise.all([
    import("../../conversation-view/interpret.js"), import("../../conversation-view/flyd-voice.js"),
    import("../../council/reply-review.js"), import("../../conversation-view/for-george.js"), import("../../runtime/honesty-check.js"),
  ]);
  const interpreter = new AnswerInterpreter({ complete, cacheFile: join(sandbox, "view", `interpretations-${testCase.id}.json`) });
  const reading = await interpreter.request({ question: reply.question, answer: reply.text, recent: [] });
  if (reading) {
    // As the window says it (conversation-view/server.ts): Flyd's reading, shaped by the reply, its lead line first.
    const [{ deliver, reportFromReply }, { choiceOf }] = await Promise.all([import("../../runtime/delivery.js"), import("../../conversation-view/choices.js")]);
    const said = deliver(reportFromReply({ id: testCase.id, reading: inFlydsVoice(reading), reply: reply.text, options: choiceOf(reply.text)?.options ?? [] }), "window");
    return said.text ? { text: said.text, shape: said.shape } : { text: condense(inFlydsVoice(reading), { keepAsk: true }), shape: "words" };
  }
  const held = !screenOutgoing({ surface: "relay", source: "relay:staff", text: inFlydsVoice(reply.text) }).send;
  return { text: held ? null : condense(stripCommitIds(reply.text)), shape: "words" };
}

/** Flyd's own answer as the window shows it: the short reply for a working diagnosis, else the body itself. */
async function answer(testCase: DeliveryCase): Promise<Pick<DeliveryObservation, "text" | "shape">> {
  const { answerBody, plainAnswer, workingReply } = await import("../../conversation-view/answer-form.js");
  const body = answerBody(testCase.answer);
  const reply = workingReply(body);
  if (reply !== null) return { text: reply, shape: "words" };
  if (body.form === "diagnosis") {
    // The card as it renders: each label above its line.
    return { text: [body.lead, ...body.parts.map((part) => `${part.label}: ${part.text}`), body.next ?? ""].filter(Boolean).join("\n"), shape: "words" };
  }
  return { text: plainAnswer(body), shape: "words" };
}

/** A window turn whose answer threw: the line under his message. */
async function deskError(testCase: DeliveryCase, sandbox: string): Promise<Pick<DeliveryObservation, "text" | "shape">> {
  const { FlydDesk } = await import("../../conversation-view/flyd-desk.js");
  const desk = new FlydDesk({ answer: async () => { throw new Error(testCase.error ?? "unknown failure"); }, dir: join(sandbox, "asks", testCase.id) });
  desk.ask(testCase.run?.words ?? "Fix the checkout bug on the market site");
  for (let wait = 0; wait < 100; wait += 1) {
    const failed = desk.exchanges().find((exchange) => exchange.waitingFailed);
    if (failed) return { text: failed.waiting, shape: "words" };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { text: null, shape: "words" };
}

/** What George is shown for one case, by today's code. */
export async function produceDelivery(testCase: DeliveryCase, complete: Complete, sandbox: string): Promise<Pick<DeliveryObservation, "text" | "shape">> {
  switch (testCase.surface) {
    case "notification": return notification(testCase);
    case "window": return window(testCase, complete, sandbox);
    case "answer": return answer(testCase);
    case "desk-error": return deskError(testCase, sandbox);
    // No path replays it yet (a model-written morning line): scored as he saw it, until Phase 1 owns that delivery.
    case "recorded": return { text: testCase.seen ?? null, shape: "words" as DeliveryShape };
  }
}
