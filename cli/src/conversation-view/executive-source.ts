import { recommendationText } from "../intelligence/executive/decision-step.js";
import { createHash } from "node:crypto";
import type { ExecutiveDecisionRecord } from "../intelligence/executive/decision-step.js";
import type { FirstmateChange } from "../intelligence/executive/firstmate-decision.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource, Exchange, ImageUpload, SentMessage } from "./types.js";

/** Staff transcripts remain evidence. All three display paths read this projection. */
export function executiveConversationSource(
  source: ConversationSource,
  decide: (changes: FirstmateChange[]) => Promise<ExecutiveDecisionRecord[]>,
  resolveDecision?: (decisionId: string, taskId: string, answer: string) => Promise<void>,
): ConversationSource {
  const projections = new Map<string, ConversationMessage | null>();
  const pending = new Map<string, Promise<void>>();
  const keyFor = (message: ConversationMessage) => createHash("sha256").update(`${message.id}\0${message.text}`).digest("hex");
  const isFlyd = (message: ConversationMessage) => message.id.startsWith("answer:") && message.answers?.startsWith("ask:");
  const project = (message: ConversationMessage): ConversationMessage | undefined => {
    if (message.role === "user" || isFlyd(message)) return message;
    return projections.get(keyFor(message)) ?? undefined;
  };
  const interpret = async (message: ConversationMessage): Promise<void> => {
    if (message.role === "user" || isFlyd(message)) return;
    const key = keyFor(message);
    if (projections.has(key)) return;
    const running = pending.get(key);
    if (running) return running;
    const work = (async () => {
      const decision = (await decide([{
        sourceId: "firstmate.reply",
        eventId: message.id,
        kind: "reply",
        state: "reported",
        label: "Staff reply",
        detail: message.text,
        evidenceRefs: [`firstmate-reply:${message.id}`],
      }]))[0];
      if (!decision?.show) { projections.set(key, null); return; }
      const text = decision.disposition === "ask_george" && decision.question
        ? `${decision.question}\n\n${(decision.options ?? []).map((option) => `- ${option}`).join("\n")}${decision.recommendation ? `\n\n${recommendationText(decision.recommendation)}` : ""}`
        : decision.summary;
      // Drop raw artefacts, site/activity hints and lifecycle metadata along with the raw words.
      projections.set(key, { id: message.id, role: "assistant", text,
        ...(message.answers ? { answers: message.answers } : {}),
        ...(message.timestamp ? { timestamp: message.timestamp } : {}) });
    })().catch(() => { projections.set(key, null); }).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  };
  const snapshot = async (value: ConversationSnapshot): Promise<ConversationSnapshot> => {
    const replies = [...value.messages, ...Object.values(value.followUps ?? {}), ...(source.exchanges?.() ?? []).flatMap((exchange) => exchange.answer ? [exchange.answer] : [])];
    // Bound historic interpretation on first open; older raw replies stay backstage.
    await Promise.all(replies.filter((message) => message.role === "assistant").slice(-20).map(interpret));
    const messages = value.messages.flatMap((message) => { const projected = project(message); return projected ? [projected] : []; });
    const followUps = Object.fromEntries(Object.entries(value.followUps ?? {}).flatMap(([id, message]) => {
      const projected = project(message);
      return projected ? [[id, projected]] : [];
    }));
    return { messages, working: false, ...(value.project ? { project: value.project } : {}), followUps };
  };
  return {
    assistantLabel: "Flyd", canSend: source.canSend,
    listSessions: () => source.listSessions(),
    read: async (id) => snapshot(await source.read(id)),
    follow: (id, update, error) => {
      let closed = false;
      let generation = 0;
      const follower = source.follow(id, (value) => {
        const current = ++generation;
        void snapshot(value).then((projected) => { if (!closed && generation === current) update(projected); }).catch(error);
      }, error);
      return { close: () => { closed = true; follower.close(); } };
    },
    send: (...args) => source.send(...args),
    ...(source.sendDecision ? { sendDecision: async (text: string, images: ImageUpload[] = [], decision?: { decisionId: string; taskId: string }): Promise<SentMessage> => {
      if (decision && resolveDecision) {
        if (images.length) throw new Error("Images cannot be attached to a fixed executive decision");
        await resolveDecision(decision.decisionId, decision.taskId, text);
        return { id: `decision:${decision.decisionId}`, timestamp: new Date().toISOString() };
      }
      return source.sendDecision!(text, images, decision);
    } } : {}),
    commands: () => source.commands(),
    image: (...args) => source.image(...args),
    exchanges: (): Exchange[] => (source.exchanges?.() ?? []).map((exchange) => {
      if (!exchange.answer) return { ...exchange, waiting: "" };
      const answer = project(exchange.answer);
      return { question: exchange.question, ...(answer ? { answer } : {}), waiting: "", settled: true, answered: true };
    }),
    ...(source.noteAnswer ? { noteAnswer: async (id: string) => {
      const message = await source.noteAnswer!(id);
      if (!message) return;
      await interpret(message);
      return project(message);
    } } : {}),
  };
}
