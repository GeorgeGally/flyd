import { describe, expect, it } from "vitest";
import { passageNote, readReply, replyNote, threaded } from "../replies.js";
import { threadReplies, type RailConversation } from "../rail.js";
import type { Exchange } from "../types.js";

const note: Exchange = {
  question: { id: "note:17-ab", role: "user", text: 'There should also be [other] "movements" for bunny.', timestamp: "2026-10-11T10:00:00Z" },
  answer: { id: "note-reply:17-ab", role: "assistant", text: "Done.\n\nClicking the bunny now makes him **jump**. Each click picks a different move.", answers: "note:17-ab", shots: ["/data/shots/bunny.png"] },
  waiting: "",
};

describe("replies to an answer", () => {
  it("quote his note, the answer's opening and its screenshot ahead of his words", () => {
    const text = replyNote(note, "  Slower spin please. ");
    expect(text).toBe('[Captain is replying from Flyd to note:17-ab — his note: "There should also be other \'movements\' for bunny."; your answer began: "Clicking the bunny now makes him jump."; the answer\'s screenshot: /data/shots/bunny.png. His reply follows.]\n\nSlower spin please.');
  });

  it("quote an outcome said under the note when there is no answer message", () => {
    const settled: Exchange = { question: { id: "ask:1-2", role: "user", text: "Fix the map" }, waiting: "The map is fixed.", settled: true };
    expect(replyNote(settled, "Thanks")).toBe('[Captain is replying from Flyd to ask:1-2 — his note: "Fix the map"; your answer began: "The map is fixed.". His reply follows.]\n\nThanks');
  });

  it("read back as his own words, with what they reply to", () => {
    const message = { id: "note:18", role: "user" as const, text: replyNote(note, "Slower spin please.") };
    expect(readReply(message)).toMatchObject({ text: "Slower spin please.", replyTo: "note:17-ab", replyQuote: "There should also be other 'movements' for bunny." });
    const plain = { id: "note:19", role: "user" as const, text: "[image: /x.png] hello" };
    expect(readReply(plain)).toBe(plain);
    const [first, second] = threaded([note, { question: message, waiting: "queued" }]);
    expect(first).toBe(note);
    expect(second!.question.replyTo).toBe("note:17-ab");
  });

  it("thread under the answer in the column, a reply to a reply under the same one, an orphan alone", () => {
    const talk = (id: string, replyTo?: string): RailConversation => ({ id, question: id, ...(replyTo ? { replyTo } : {}) });
    const threads = threadReplies([talk("a"), talk("b"), talk("c", "a"), talk("d", "c"), talk("e", "gone")]);
    expect(threads.map((conversation) => conversation.id)).toEqual(["a", "b", "e"]);
    expect(threads[0]!.replies!.map((reply) => reply.id)).toEqual(["c", "d"]);
    expect(threads[1]!.replies).toBeUndefined();
  });
});

describe("a comment on a passage he selected", () => {
  it("names the conversation and whose words they were, and quotes the passage whole", () => {
    const conversation = { id: "s1", title: "Island tweaks" };
    expect(passageNote({ quote: "  The island runs\n\n\n\nfrom the notch.  ", from: "assistant", assistant: "Flyd", conversation }, " Make it faster. "))
      .toBe('Comment on a passage of Flyd\'s reply in the conversation "Island tweaks" (session s1):\n\n> The island runs\n>\n> from the notch.\n\nMake it faster.');
    expect(passageNote({ quote: "Ship it", from: "user", assistant: "Flyd", conversation: { id: "s1" } }, "I meant tomorrow"))
      .toBe("Comment on a passage of my message in the conversation session s1:\n\n> Ship it\n\nI meant tomorrow");
  });
});
