import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutoAnswers, settledBy } from "../auto-answers.js";
import { choiceOf } from "../choices.js";
import { readReply } from "../replies.js";
import type { ConversationMessage } from "../types.js";

// His recorded words, as USER.md keeps them.
const PROFILE = `## How to be with me
- Keep every reply to at most two paragraphs, always — a standing cap, not a one-off. (2026-09-29)
- Merge green Flyd PRs without asking — land the work and tell him after, not before. (2026-10-10)
- When he asks to see a website or UI, start the local preview server and send him the URL so he sees the real thing, not a description. (2026-10-09)`;

const AT = "2026-10-12T04:09:39.714Z";
const reply = (text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id: "reply:b#383", role: "assistant", text, timestamp: AT, aside: true, ...extra });
const settle = (message: ConversationMessage, profile = PROFILE) => settledBy(message, choiceOf(message.text)!, profile);

const MERGE = "The notes-read change is done and all its checks are green: https://github.com/GeorgeGally/flyd/pull/122\n\nShould I merge it?";

describe("settledBy", () => {
  it("answers a merge of green Flyd work yes, by his own recorded words", () => {
    expect(settle(reply(MERGE))).toEqual({ rule: "merge-green-flyd", answer: "Yes", because: "Merge green Flyd PRs without asking — land the work and tell him after, not before." });
    expect(settle(reply("Checks passed. Should I land the Flyd change now?"))?.rule).toBe("merge-green-flyd");
  });

  it("answers starting a preview yes, so he sees the real thing", () => {
    expect(settle(reply("The menu is rebuilt. Want me to start the local preview so you can see it?"))?.rule).toBe("show-the-real-thing");
  });

  it("leaves him the question when his recorded words for the rule are gone", () => {
    expect(settle(reply(MERGE), PROFILE.split("\n").filter((line) => !/Merge green/.test(line)).join("\n"))).toBeNull();
  });

  it("leaves him anything that is not green, not Flyd's, or not a yes-or-no", () => {
    expect(settle(reply(MERGE.replace("all its checks are green", "one check is failing")))).toBeNull();
    expect(settle(reply("The Christmas site change is ready: https://github.com/GeorgeGally/good_neighbours/pull/40\n\nShould I merge it?"))).toBeNull();
    expect(settle(reply("Checks are green on the Flyd change. Should I merge now or wait for your review?"))).toBeNull();
  });

  it("never answers for him what firstmate wants his own word on, or what cannot be taken back", () => {
    // The question that started this: firstmate wanted his yes, and it changes shared code.
    const fix2 = "2. **Firstmate checks the notes queue itself (needs your go):** This changes Firstmate's shared code, so I want your yes first.\n\nShould I go ahead with fix 2?";
    expect(settle(reply(fix2))).toBeNull();
    expect(settle(reply("Checks are green on the Flyd change. It needs your go. Should I merge it?"))).toBeNull();
    expect(settle(reply("Checks are green on the Flyd change. Should I merge it and delete the old branch?"))).toBeNull();
    expect(settle(reply("Checks are green on the Flyd change. Should I merge and deploy it?"))).toBeNull();
  });

  it("answers only firstmate, never Flyd's own desk", () => {
    expect(settle(reply("Checks are green on the Flyd change. Should I merge it?", { id: "ask-reply:1", answers: "ask:1" }))).toBeNull();
  });
});

describe("AutoAnswers", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const open = (message: ConversationMessage) => ({ message, choice: choiceOf(message.text)! });

  it("answers once through the note path, says by which rule, and logs it", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-auto-"));
    const logFile = join(dir, "auto-answers.jsonl");
    const sent: string[] = [];
    const send = async (note: string) => {
      sent.push(note);
      return { id: `note:${sent.length}`, timestamp: AT };
    };
    const auto = new AutoAnswers({ preferences: () => PROFILE, logFile, now: () => Date.parse(AT) + 60_000 });
    const entry = await auto.answer("s1", open(reply(MERGE)), send);
    expect(entry).toMatchObject({ asked: "reply:b#383", target: "reply:b#383", question: "Should I merge it?", answer: "Yes", rule: "merge-green-flyd", note: "note:1" });
    expect(sent).toEqual([
      '[Flyd is answering for the captain to reply:b#383 — your question: "Should I merge it?"; by his standing rule: "Merge green Flyd PRs without asking — land the work and tell him after, not before.". He can take it back.]\n\nYes',
    ]);
    // Read back, it is Flyd's answer to that question, not his own words.
    expect(readReply({ id: "note:1", role: "user", text: sent[0]! })).toMatchObject({ text: "Yes", replyTo: "reply:b#383", replyQuote: "Should I merge it?", answeredFor: "Merge green Flyd PRs without asking — land the work and tell him after, not before." });
    // Once, even across a restart.
    expect(await auto.answer("s1", open(reply(MERGE)), send)).toBeNull();
    expect(await new AutoAnswers({ preferences: () => PROFILE, logFile, now: () => Date.parse(AT) + 60_000 }).answer("s1", open(reply(MERGE)), send)).toBeNull();
    expect(sent).toHaveLength(1);
    expect(readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).rule)).toEqual(["merge-green-flyd"]);
  });

  it("leaves a question he may already be weighing: one asked more than a few minutes ago", async () => {
    const sent: string[] = [];
    const auto = new AutoAnswers({ preferences: () => PROFILE, now: () => Date.parse(AT) + 60 * 60_000 });
    expect(await auto.answer("s1", open(reply(MERGE)), async (note) => (sent.push(note), { id: "note:1", timestamp: AT }))).toBeNull();
    expect(sent).toEqual([]);
  });

  it("takes an answer back for him: the session holds off, and it is logged", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-auto-"));
    const logFile = join(dir, "auto-answers.jsonl");
    const sent: string[] = [];
    const auto = new AutoAnswers({ preferences: () => PROFILE, logFile, now: () => Date.parse(AT) + 60_000 });
    const flyds = { id: "note:1", role: "user" as const, text: "Yes", replyTo: "reply:b#383", replyQuote: "Should I merge it?", answeredFor: "Merge green Flyd PRs without asking" };
    await auto.undo(flyds, async (note) => (sent.push(note), { id: "note:2", timestamp: AT }));
    expect(sent[0]).toBe('[Captain is replying from Flyd to reply:b#383 — your question: "Should I merge it?"; he takes back the answer Flyd gave for him ("Yes") and will answer himself. Hold off until he does.]\n\nHold off on that; I\'ll answer this one myself.');
    expect(readReply({ id: "note:2", role: "user", text: sent[0]! })).toMatchObject({ replyTo: "reply:b#383", undoes: true });
    expect(JSON.parse(readFileSync(logFile, "utf8").trim())).toMatchObject({ undo: "note:1", target: "reply:b#383", note: "note:2" });
    await expect(auto.undo({ ...flyds, answeredFor: undefined }, async () => ({ id: "x", timestamp: AT }))).rejects.toThrow();
  });
});
