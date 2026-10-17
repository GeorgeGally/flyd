import { describe, expect, it } from "vitest";
import { AutoAnswers, settledBy } from "../auto-answers.js";
import { choiceOf, openChoice } from "../choices.js";
import { brief, stateOf } from "../executive.js";
import { readReply } from "../replies.js";
import { SnapshotDiffer } from "../server.js";
import { statusOf } from "../status.js";
import type { ConversationMessage } from "../types.js";
import { TWO_THINGS_WAITING } from "./fixtures/replies.js";

// Flyd is George's chief of staff: firstmate's routine questions are Flyd's to
// answer, by his standing words, and only what is destructive, costly, public
// or a real taste call reaches him. The reply that started this is
// TWO_THINGS_WAITING: Flyd relayed both of its questions to him, filed the
// push question as "under way" and the unstarted plan as "landed".

// His recorded words, as USER.md and firstmate's captain memos keep them.
const PROFILE = `- George expects assistants/agents to take control of situations and solve problems autonomously rather than sending problems back to him. (2026-10-14)
- George does not want to be given extra work or decisions. (2026-10-17)
- Treat a local copy as equal to the git copy. Never ask whether to sync a local clone; assume it should match its remote's default branch and fast-forward it on sight. Never discard uncommitted or unlanded local work to do so — stop and report that instead.`;

const AT = "2026-10-17T03:20:33.033Z";
const reply = (text: string): ConversationMessage => ({ id: "reply:fm#1", role: "assistant", text, timestamp: AT, aside: true });
const PUSH = "Shall I put today's local Flyd commit on top of GitHub's latest and push it?";
const COMMAND = "Do you want the command that lets firstmate message Flyd and get a real reply?";

/** Flyd's answers, sent and read back as the session's messages would show them. */
async function answered(message: ConversationMessage, profile = PROFILE): Promise<ConversationMessage[]> {
  const sent: string[] = [];
  const auto = new AutoAnswers({ preferences: () => profile, now: () => Date.parse(AT) + 60_000 });
  await auto.answer("s1", openChoice([message]), async (note) => (sent.push(note), { id: `note:${sent.length}`, timestamp: AT }));
  return sent.map((text, index) => readReply({ id: `note:${index + 1}`, role: "user", text, timestamp: AT }));
}

describe("the status card reads a reply by what it means", () => {
  it("files the screenshot's questions as his and the plan as no state at all", () => {
    const items = brief(TWO_THINGS_WAITING).items.map((item) => [item.state, item.text]);
    expect(items).toEqual([["needs", PUSH], ["needs", COMMAND]]);
    // The plan is not landed: "Merged" was only a quoted example, and the work is still to come.
    expect(brief(TWO_THINGS_WAITING).prose).toContain("Fix the messages where Flyd writes them");
  });

  it("reads a question as a question, a quote as a quote, and the future as not done", () => {
    expect(stateOf(`${PUSH} Until then, fixes that land won't reach the running Flyd.`)).toBe("needs");
    expect(stateOf('The fix for "Merged deployed." will be worded properly from the start.')).toBeNull();
    expect(stateOf("The fix will be merged once checks pass.")).toBe("underway");
    expect(stateOf("The menu fix is merged.")).toBe("landed");
  });
});

describe("Flyd decides its staff's routine questions", () => {
  it("answers both of the screenshot's questions itself, each by a standing word of his", () => {
    const choice = choiceOf(TWO_THINGS_WAITING)!;
    expect(choice.steps?.map((step) => step.question)).toEqual([PUSH, COMMAND]);
    const [push, command] = choice.steps!.map((step) => settledBy(reply(TWO_THINGS_WAITING), step, PROFILE));
    expect(push).toMatchObject({ rule: "sync-green-work", answer: "Yes", because: "Never ask whether to sync a local clone; assume it should match its remote's default branch and fast-forward it on sight" });
    expect(command).toMatchObject({ rule: "obvious-follow-up", answer: "Yes" });
  });

  it("answers a routine push or rebase question for him: it never shows as needing him", async () => {
    const asked = reply(TWO_THINGS_WAITING);
    const notes = await answered(asked);
    expect(notes.map((note) => note.replyQuote)).toEqual([PUSH, COMMAND]);
    expect(notes.every((note) => note.answeredFor && note.text === "Yes")).toBe(true);
    // Nothing is left for him to answer, in the window or on the island.
    expect(openChoice([asked, ...notes])).toBeNull();
    const [shown] = new SnapshotDiffer().next({ messages: [asked, ...notes], working: false }).messages;
    expect(shown!.summary!.html).toContain("Handled");
    expect(shown!.summary!.html).not.toContain("k-call");
    expect(statusOf({ messages: [asked, ...notes], working: false }).reply).toMatchObject({ asks: false });
    // Before Flyd answers, the same reply asks him.
    expect(new SnapshotDiffer().next({ messages: [asked], working: false }).messages[0]!.summary!.html).toContain("k-call");
  });

  it("tells firstmate it speaks with his delegated authority", async () => {
    const sent: string[] = [];
    await new AutoAnswers({ preferences: () => PROFILE, now: () => Date.parse(AT) + 60_000 })
      .answer("s1", openChoice([reply("Rebased onto the latest; everything is green.\n\nShall I push it?")]), async (note) => (sent.push(note), { id: "note:1", timestamp: AT }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Flyd decides this with his delegated authority: act on it as his word.");
  });

  it("still brings him what is destructive, irreversible, costly or public", async () => {
    for (const question of [
      "Shall I force-push over GitHub's copy?",
      "Shall I delete the old branches and push?",
      "Shall I discard the local edits and sync?",
      "Shall I deploy it to production?",
      "Do you want me to buy the domain?",
      "Do you want the new homepage design?",
    ]) {
      const asked = reply(`The work is green.\n\n${question}`);
      expect(await answered(asked), question).toEqual([]);
      expect(openChoice([asked])?.choice.question, question).toBe(question);
    }
  });

  it("answers the routine question of two and leaves him the destructive one", async () => {
    const asked = reply(`Two things are waiting on you:\n1. Shall I rebase the menu fix onto the latest and push it?\n2. Shall I delete the old preview servers' data?`);
    const notes = await answered(asked);
    expect(notes.map((note) => note.replyQuote)).toEqual(["Shall I rebase the menu fix onto the latest and push it?"]);
    expect(openChoice([asked, ...notes])?.choice).toEqual({ question: "Shall I delete the old preview servers' data?", options: ["Yes", "No"] });
    const [shown] = new SnapshotDiffer().next({ messages: [asked, ...notes], working: false }).messages;
    const html = shown!.summary?.html ?? shown!.html;
    expect(html).toContain("k-call");
    expect(html).toContain("Handled");
  });

  it("leaves him every question when his standing words are gone", async () => {
    expect(await answered(reply(TWO_THINGS_WAITING), "- Keep replies short. (2026-09-29)")).toEqual([]);
  });
});
