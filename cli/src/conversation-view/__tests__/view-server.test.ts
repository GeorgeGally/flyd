import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox, type CaptainInbox } from "../firstmate-inbox.js";
import type { ConversationMessage, Exchange } from "../types.js";
import { fenceCaptainCode, renderCaptainMarkdown, renderMarkdown } from "../markdown.js";
import { ActivityReader } from "../activity.js";
import { artefactAsk } from "../replies.js";
import { ArtefactFeed, fleetCounts, heldItems } from "../artefact.js";
import { HeldOutcomes } from "../held.js";
import { ConversationViewServer, replyCards, SnapshotDiffer } from "../server.js";
import { AutoAnswers } from "../auto-answers.js";
import { ComposerPredictions } from "../composer-predictions.js";
import { ComposerDrafts } from "../drafts.js";
import { ReplySummarizer } from "../summaries.js";
import { ArtefactJudge } from "../artefact-judge.js";
import { MAX_CHARS } from "../for-george.js";
import { readTaste, writeTaste } from "../../council/taste.js";
import { KINSTA_RULES, KINSTA_TABLE, STAFF_DECISION, STAFF_LANDED, STAFF_PROGRESS } from "./fixtures/replies.js";
import { assistantText, captain, captainBlocks, toolUse } from "./transcript-fixture.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("renderMarkdown", () => {
  it("renders tables, lists, code and links", () => {
    const html = renderMarkdown("## Done\n\n- **one**\n- `two`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[pr](https://github.com/x/y/pull/1)");
    expect(html).toContain("<h2>Done</h2>");
    expect(html).toContain("<strong>one</strong>");
    expect(html).toContain("<code>two</code>");
    expect(html).toContain("<table>");
    expect(html).toContain('<a href="https://github.com/x/y/pull/1" target="_blank" rel="noopener noreferrer">pr</a>');
  });

  it("escapes raw HTML and drops unsafe links and remote images", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nsee <img src=x onerror=alert(1)> [x](javascript:alert(1)) ![logo](https://tracker.example/p.png)');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<span class="pill">logo</span>');
  });

  it("marks pasted screenshots", () => {
    expect(renderMarkdown("[Image #3] squashed")).toContain('<span class="pill">image 3</span>');
  });
});

describe("pasted code in the captain's messages", () => {
  const paste = "change to @media (max-width: 640px) {\n    body .adviser-section .adviser-inner h2 {\n        font-size: 10vw;\n    }\n}";

  it("renders an indented multi-line paste as one preformatted block with its indentation", () => {
    const html = renderCaptainMarkdown(paste);
    expect(html).toBe(
      "<p>change to</p>\n<pre><code>@media (max-width: 640px) {\n    body .adviser-section .adviser-inner h2 {\n        font-size: 10vw;\n    }\n}\n</code></pre>\n",
    );
    expect(html).not.toContain("<br>");
  });

  it("leaves prose, single lines and existing fences alone", () => {
    expect(fenceCaptainCode("make the menu smaller\nand the footer wider")).toBe("make the menu smaller\nand the footer wider");
    expect(fenceCaptainCode("set .x { color: red; }")).toBe("set .x { color: red; }");
    const fenced = "look:\n```\n  a {\n  }\n```";
    expect(fenceCaptainCode(fenced)).toBe(fenced);
  });

  it("keeps code that follows a sentence on its own lines", () => {
    expect(fenceCaptainCode("for mobile:\n.hero {\n  padding: 18px;\n}")).toBe("for mobile:\n```\n.hero {\n  padding: 18px;\n}\n```");
  });
});

describe("SnapshotDiffer", () => {
  it("points an actionable numbered reply at Artefacts and keeps the whole reply behind it", () => {
    const steps = "Captain, update the redirect rules in Kinsta.\n\n1. Delete the existing catch-all rule.\n2. Add ^/(.*)$ → https://capfive.com/$1 as a 301 redirect.\n3. Move the specific redirect rules above the general rule.\n\nOrder matters: specifics stay above.";
    const differ = new SnapshotDiffer();
    const update = differ.next({ messages: [{ id: "answer", role: "assistant", text: steps, answers: "note:redirects" }], working: false });
    expect(update.messages[0]?.summary).toEqual({ html: "<p><strong>Update the redirect rules in Kinsta</strong>: 3 steps, kept in Artefacts.</p>\n", source: "flyd" });
    expect(update.messages[0]?.html).toContain("Order matters: specifics stay above.");
    expect(update.messages[0]?.artifact).toEqual({ title: "Update the redirect rules in Kinsta", steps: [
      "Delete the existing catch-all rule.",
      "Add ^/(.*)$ → https://capfive.com/$1 as a 301 redirect.",
      "Move the specific redirect rules above the general rule.",
    ] });

    const plain = differ.next({ messages: [{ id: "plain", role: "assistant", text: "Yes, the specific rules should stay above the general rule.", answers: "note:redirects" }], working: false });
    expect(plain.messages[0]?.html).toContain("Yes, the specific rules should stay above the general rule.");
    expect(plain.messages[0]?.artifact).toBeUndefined();
  });

  it("sends each message once and again only when its text changes", () => {
    const differ = new SnapshotDiffer();
    const first = differ.next({ messages: [{ id: "a", role: "user", text: "hi" }], working: true });
    expect(first.messages.map((m) => m.id)).toEqual(["a"]);
    const second = differ.next({ messages: [{ id: "a", role: "user", text: "hi" }, { id: "b", role: "assistant", text: "**yo**" }], working: false });
    expect(second.order).toEqual(["a", "b"]);
    expect(second.messages).toEqual([{ id: "b", role: "assistant", html: "<p><strong>yo</strong></p>\n" }]);
    expect(differ.next({ messages: [{ id: "a", role: "user", text: "hi" }], working: false }).messages).toEqual([]);
  });
});

describe("SnapshotDiffer closed pages", () => {
  it("says a closed local review page in words on the artefact and never offers it in the header", () => {
    const text = "Answer to pending decision visuals: Pick a look\nQuestion: board http://127.0.0.1:4387/session/a";
    const live = (url: string) => (url.includes(":4387") ? "down" : "up");
    expect(new SnapshotDiffer(undefined, { live }).next({ messages: [{ id: "a", role: "user", text }], working: false }).page).toBeUndefined();
    expect(new SnapshotDiffer(undefined, { live: () => "up" }).next({ messages: [{ id: "a", role: "user", text }], working: false }).page).toMatchObject({ host: "127.0.0.1:4387", local: true });
  });
});

describe("SnapshotDiffer relays", () => {
  it("drops routine relayed updates, keeps ones with an outcome, and carries the pairing to the page", () => {
    const differ = new SnapshotDiffer();
    const update = differ.next({
      messages: [
        { id: "note:1", role: "user", text: "whats on in bkk tonight?", waiting: "passed to firstmate" },
        { id: "t1", role: "assistant", text: "Sir, standing by.", aside: true },
        { id: "t2", role: "assistant", text: "Sir, the island filter is still paused on your call. A or B?", aside: true },
      ],
      working: false,
    });
    expect(update.order).toEqual(["note:1", "t2"]);
    expect(update.messages.map((m) => [m.id, m.waiting, m.aside])).toEqual([["note:1", "passed to firstmate", undefined], ["t2", undefined, true]]);

    const answered = differ.next({
      messages: [
        { id: "note:1", role: "user", text: "whats on in bkk tonight?" },
        { id: "note-reply:1", role: "assistant", text: "Art bangkok, sir.", answers: "note:1" },
        { id: "t2", role: "assistant", text: "Sir, the island filter is still paused on your call. A or B?", aside: true },
      ],
      working: false,
    });
    expect(answered.order).toEqual(["note:1", "note-reply:1", "t2"]);
    expect(answered.messages.map((m) => [m.id, m.waiting, m.answers])).toEqual([["note:1", undefined, undefined], ["note-reply:1", undefined, "note:1"]]);
  });

  it("keeps a fifteen-line staff progress report from him: no message at all", () => {
    const update = new SnapshotDiffer().next({ messages: [{ id: "t1", role: "assistant", text: STAFF_PROGRESS, aside: true }], working: false });
    expect(update.order).toEqual([]);
    expect(update.messages).toEqual([]);
  });

  it("tells him a landed pull request in one line with its link, the staff's words behind more", () => {
    const [landed] = new SnapshotDiffer().next({ messages: [{ id: "t1", role: "assistant", text: STAFF_LANDED, aside: true }], working: false }).messages;
    expect(landed!.summary).toEqual({ html: renderMarkdown("The island text fix is merged: https://github.com/GeorgeGally/flyd/pull/162"), source: "flyd" });
    expect(landed!.summary!.html.match(/<p>/g)).toHaveLength(1);
    expect(landed!.html).toContain("crewmate");
  });

  it("puts a decision only he can make to him in one line, its options as buttons", () => {
    const [asked] = new SnapshotDiffer().next({ messages: [{ id: "t1", role: "assistant", text: STAFF_DECISION, aside: true }], working: false }).messages;
    expect(asked!.choice).toMatchObject({ options: ["The boardroom photo", "The skyline photo"], replyTo: "t1" });
    expect(asked!.summary!.source).toBe("flyd");
    expect(asked!.summary!.html).not.toContain("<li>");
    expect(asked!.summary!.html.match(/<p>/g)).toHaveLength(1);
  });

  it("shows a question the staff asked twice once, where it was asked last", () => {
    const asked = "Sir, still waiting on you: may I delete the 44,148 test-junk records from Flyd's memory? A backup is taken first.";
    const update = new SnapshotDiffer().next({ messages: [
      { id: "t1", role: "assistant", text: asked, aside: true },
      { id: "t2", role: "assistant", text: `Sir, shipshape. ${asked.replace("Sir, ", "")}`, aside: true },
    ], working: false });
    expect(update.order).toEqual(["t2"]);
    // Asked mid-reply, it is still answerable where it stands.
    expect(update.messages[0]!.choice).toMatchObject({ question: "May I delete the 44,148 test-junk records from Flyd's memory?", options: ["Yes", "No"], replyTo: "t2" });
    const answered = new SnapshotDiffer().next({ messages: [{ id: "t1", role: "assistant", text: asked, aside: true }, { id: "note:1", role: "user", text: "yes, delete it" }], working: false });
    expect(answered.messages.find((message) => message.id === "t1")!.choice).toBeUndefined();
  });

  it("tells him an answer as one compact card: its outcome, the line under it, the rest behind more", () => {
    const answer = "Sir, the big dark data band on the vendor admin page is gone. In its place is one slim line above the board: a small Data button, then the counts. Click the button and the full figures open below it, as before.";
    const [, shown] = new SnapshotDiffer().next({ messages: [
      { id: "u1", role: "user", text: "That data column is like so prevalent, and it shouldn't be." },
      { id: "t1", role: "assistant", text: answer, aside: true },
    ], working: false }).messages;
    expect(shown!.card).toEqual({
      kind: "landed",
      line: "The big dark data band on the vendor admin page is gone.",
      sub: "In its place is one slim line above the board: a small Data button, then the counts.",
    });
    expect(shown!.html).toContain("as before");
    expect(shown!.summary).toBeDefined();
  });

  it("never calls a reply that puts nothing to him his call, nor says a short one twice", () => {
    const status = "The fleet is moving: three jobs are open and none is waiting on you right now.";
    const [, shown] = new SnapshotDiffer().next({ messages: [
      { id: "u1", role: "user", text: "how is it going?" },
      { id: "t1", role: "assistant", text: status, aside: true },
    ], working: false }).messages;
    expect(shown!.card?.kind).not.toBe("decision");
    // The card is the glance; the reply as written waits behind it, not under it as well.
    expect(shown!.card!.line).toContain("none is waiting on you");
    expect(shown!.summary).toBeDefined();
  });

  it("keeps the rules he has to paste open under the card that leads a relayed answer", () => {
    const [, shown] = new SnapshotDiffer().next({ messages: [
      { id: "note:1", role: "user", text: "what are the kinsta rules again" },
      { id: "t1", role: "assistant", text: KINSTA_RULES, answers: "note:1" },
    ], working: false }).messages;
    expect(shown!.card).toBeDefined();
    expect(shown!.expanded).toBe(true);
    expect(shown!.html).toContain("https://capfive.com/$1");
  });

  it("still answers him when he typed into the session himself", () => {
    const update = new SnapshotDiffer().next({ messages: [{ id: "u1", role: "user", text: "how is the island work going?" }, { id: "t1", role: "assistant", text: STAFF_PROGRESS, aside: true }], working: false });
    expect(update.order).toEqual(["u1", "t1"]);
  });

  it("holds Flyd's own long answer to a few lines, a short one shown whole", () => {
    const long = "Christmas is 69 days away. " + "It falls on a Friday this year, so the long weekend runs into Monday and most shops close early on the Thursday. ".repeat(5);
    const update = new SnapshotDiffer().next({ messages: [
      { id: "ask:1", role: "user", text: "how many days until christmas?" },
      { id: "ask-reply:1", role: "assistant", text: long, answers: "ask:1" },
      { id: "ask:2", role: "user", text: "and new year?" },
      { id: "ask-reply:2", role: "assistant", text: "76 days, sir.", answers: "ask:2" },
    ], working: false });
    const [first, second] = update.messages.filter((message) => message.role === "assistant");
    expect(first!.summary!.source).toBe("flyd");
    expect(first!.summary!.html.replace(/<[^>]+>/g, "").trim().length).toBeLessThanOrEqual(MAX_CHARS);
    expect(first!.summary!.html).toContain("Christmas is 69 days away.");
    expect(second!.summary).toBeUndefined();
    expect(second!.html).toContain("76 days, sir.");
  });

  it("tells the page when a question's line says its answer failed", () => {
    const differ = new SnapshotDiffer();
    const asking = differ.next({ messages: [{ id: "ask:1", role: "user", text: "weather?", waiting: "Working on it" }], working: false });
    expect(asking.messages[0]!.waitingFailed).toBeUndefined();
    const failed = differ.next({ messages: [{ id: "ask:1", role: "user", text: "weather?", waiting: "Flyd couldn't answer this: offline", waitingFailed: true }], working: false });
    expect(failed.messages.map((m) => [m.waiting, m.waitingFailed])).toEqual([["Flyd couldn't answer this: offline", true]]);
  });
});

describe("SnapshotDiffer summaries", () => {
  const long = "Captain, the menu bar now sits ten pixels higher on every page, including the member login. " +
    "I checked it in the browser on desktop and mobile, and the change is committed but not pushed yet. ".repeat(2);
  const message = (id: string, text: string) => ({ id, role: "assistant" as const, text });

  function withModel(answer: () => Promise<string>) {
    let landed = 0;
    const cacheFile = join(mkdtempSync(join(tmpdir(), "flyd-view-sum-")), "s.json");
    const summarizer = new ReplySummarizer({ providers: [{ name: "fake", summarize: answer }], cacheFile });
    return { summarizer, landed: () => landed, onSummary: () => (landed += 1) };
  }

  function jev(kind: string, confidence = 0.9): { judge: ArtefactJudge; release: () => void; asked: () => number } {
    let asked = 0;
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    const fetchFn = (async () => {
      asked += 1;
      await answered;
      return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers: { reply_artefact_kind: { type: "choice", choice: kind, confidence, probabilities: { [kind]: confidence } } }, usage: { input_tokens: 10, output_tokens: 1 } }) };
    }) as unknown as typeof fetch;
    return { judge: new ArtefactJudge({ apiKey: "test", fetchFn }), release, asked: () => asked };
  }
  const unclear = "Captain, for the aicanetwork.com redirects:\n\n1. Order: the specific rules stay first.\n2. The general rule ^/(.*)$ → https://capfive.com/$1 goes last as a 301.\n3. Delete the old ^/$ catch-all.";

  it("asks no model summary for a reply the rule makes an artefact", () => {
    let calls = 0;
    const model = withModel(async () => (calls++, "x"));
    const reply = `Captain, the redirect fix.\n\n1. In MyKinsta, delete the ^/$ rule.\n2. Then add ^/(.*)$ → https://capfive.com/$1 as a 301.\n\n${long}`;
    const [rendered] = new SnapshotDiffer(model).next({ messages: [message("r1", reply)], working: false }).messages;
    expect(rendered!.artifact?.steps).toHaveLength(2);
    expect(calls).toBe(0);
  });

  it("lets Flyd's judge decide unclear steps, holding the summary until it has", async () => {
    let calls = 0;
    const model = withModel(async () => (calls++, "x"));
    const { judge, release, asked } = jev("steps");
    const differ = new SnapshotDiffer({ ...model, artefacts: judge });
    const reply = `${unclear}\n\n${long}`;
    const first = differ.next({ messages: [message("r1", reply)], working: false }).messages[0]!;
    expect(first.artifact).toBeUndefined();
    expect(asked()).toBe(1);
    release();
    await vi.waitFor(() => expect(model.landed()).toBe(1));
    const judged = differ.next({ messages: [message("r1", reply)], working: false }).messages[0]!;
    expect(judged.artifact?.title).toBe("For the aicanetwork.com redirects");
    expect(judged.html).toContain("Delete the old ^/$ catch-all.");
    expect(calls).toBe(0);
    expect(asked()).toBe(1);
  });

  it("labels options Flyd's judge keeps as options, never steps", async () => {
    const { judge, release } = jev("options");
    const differ = new SnapshotDiffer({ artefacts: judge });
    const reply = "Two ways to fix it:\n1. Use a wildcard rule — simpler.\n2. Keep separate rules — more control.";
    expect(differ.next({ messages: [message("r1", reply)], working: false }).messages[0]!.artifact).toBeUndefined();
    release();
    await vi.waitFor(() => expect(judge.cached(reply)).toBe("options"));
    const judged = differ.next({ messages: [message("r1", reply)], working: false }).messages[0]!;
    expect(judged.summary).toEqual({ html: "<p><strong>Two ways to fix it</strong>: 2 options, kept in Artefacts.</p>\n", source: "flyd" });
  });

  it("labels steps that mention a choice as steps when Flyd's judge says they are", async () => {
    for (const [reply, title] of [
      ["Captain, fix the redirects.\n1. In MyKinsta, delete the ^/$ rule.\n2. Add ^/(.*)$ → https://capfive.com/$1 as a 301 or 302.", "Fix the redirects"],
      ["1. Open Settings → Options.\n2. Click Save.", "Steps to follow"],
    ] as const) {
      const { judge, release } = jev("steps");
      const differ = new SnapshotDiffer({ artefacts: judge });
      differ.next({ messages: [message("r1", reply)], working: false });
      release();
      await vi.waitFor(() => expect(judge.cached(reply)).toBe("steps"));
      const judged = differ.next({ messages: [message("r1", reply)], working: false }).messages[0]!;
      expect(judged.summary).toEqual({ html: `<p><strong>${title}</strong>: 2 steps, kept in Artefacts.</p>\n`, source: "flyd" });
    }
  });

  it("puts options in the column as a choice that answers the reply, and steps as a list", async () => {
    const { judge, release } = jev("options");
    const options = "Two ways to fix it:\n1. Use a wildcard rule — simpler.\n2. Keep separate rules — more control.";
    const steps = "Captain, fix the redirects.\n\n1. Delete the ^/$ rule.\n2. Add ^/(.*)$ as a 301.";
    const messages = [
      { id: "r1", role: "assistant" as const, text: options, answers: "note:1" },
      { id: "r2", role: "assistant" as const, text: steps },
    ];
    void judge.request(options);
    release();
    await vi.waitFor(() => expect(judge.cached(options)).toBe("options"));
    expect(replyCards(messages, judge)).toEqual([
      { id: "reply:r2", title: "Fix the redirects", steps: ["Delete the ^/$ rule.", "Add ^/(.*)$ as a 301."] },
      { id: "reply:r1", title: "Two ways to fix it", choice: { question: "Two ways to fix it", options: ["Use a wildcard rule", "Keep separate rules"], replyTo: "note:1" } },
    ]);
    // Answered, by a tap or in his own words, the options are only listed: one tap never answers twice.
    const listed = { id: "reply:r1", title: "Two ways to fix it", choice: { question: "Two ways to fix it", options: ["Use a wildcard rule", "Keep separate rules"] } };
    expect(replyCards([messages[0]!, { id: "u1", role: "user", text: "Use a wildcard rule", replyTo: "note:1" }], judge)).toEqual([listed]);
    expect(replyCards([messages[0]!, { id: "note:2", role: "user", text: "use a wildcard rule, please" }], judge)).toEqual([listed]);
    expect(replyCards([messages[0]!, { id: "note:2", role: "user", text: "also, the footer is off" }], judge)[0]!.choice!.replyTo).toBe("note:1");
    // A reply that closes on its own question is answered in the window's card, never a second one here.
    const asks = `${options}\n\nWhich do you want?`;
    const asked = jev("options");
    void asked.judge.request(asks);
    asked.release();
    await vi.waitFor(() => expect(asked.judge.cached(asks)).toBe("options"));
    expect(replyCards([{ id: "r1", role: "assistant", text: asks, answers: "note:1" }], asked.judge)[0]!.choice!.replyTo).toBeUndefined();
  });

  it("lists an options reply that answers nothing of his, so no tap posts a reply that cannot be routed", async () => {
    const { judge, release } = jev("options");
    const reply = "Two ways to fix it:\n1. Use a wildcard rule — simpler.\n2. Keep separate rules — more control.";
    void judge.request(reply);
    release();
    await vi.waitFor(() => expect(judge.cached(reply)).toBe("options"));
    expect(replyCards([{ id: "r1", role: "assistant", text: reply }], judge)).toEqual([
      { id: "reply:r1", title: "Two ways to fix it", choice: { question: "Two ways to fix it", options: ["Use a wildcard rule", "Keep separate rules"] } },
    ]);
  });

  it("keeps items as text when Flyd's judge is unsure of their kind", async () => {
    const { judge, release } = jev("options", 0.4);
    const differ = new SnapshotDiffer({ artefacts: judge });
    const reply = "Two ways to fix it:\n1. Use a wildcard rule — simpler.\n2. Keep separate rules — more control.";
    differ.next({ messages: [message("r1", reply)], working: false });
    release();
    await vi.waitFor(() => expect(judge.cached(reply)).toBe("text"));
    const [rendered] = new SnapshotDiffer({ artefacts: judge }).next({ messages: [message("r1", reply)], working: false }).messages;
    expect(rendered!.artifact).toBeUndefined();
    expect(rendered!.html).toContain("Use a wildcard rule");
  });

  it("keeps the reply's own » summary lines out of an artefact's title and body", () => {
    const reply = "» Fixed the redirects plan.\n\nCaptain, finish the redirects.\n\n1. Delete the ^/$ rule.\n2. Add ^/(.*)$ as a 301.";
    const [rendered] = new SnapshotDiffer().next({ messages: [message("r1", reply)], working: false }).messages;
    expect(rendered!.artifact?.title).toBe("Finish the redirects");
    expect(rendered!.html).not.toContain("Fixed the redirects plan");
  });

  it("re-renders while the judge is out without asking it again", async () => {
    const { judge, release, asked } = jev("steps");
    let renders = 0;
    const reply = `${unclear}\n\n${long}`;
    const snapshot = { messages: [message("r1", reply)], working: false };
    // The stream re-renders on every landed answer, as ConversationViewServer does.
    const differ: SnapshotDiffer = new SnapshotDiffer({ artefacts: judge, onSummary: () => { renders += 1; if (renders < 50) differ.next(snapshot); } });
    differ.next(snapshot);
    differ.next(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(renders).toBe(0);
    expect(asked()).toBe(1);
    release();
    await vi.waitFor(() => expect(renders).toBe(1));
    expect(differ.next(snapshot).messages).toEqual([]);
  });

  it("keeps unclear steps as text when Flyd's judge says so", async () => {
    let calls = 0;
    const model = withModel(async () => (calls++, "Redirects explained."));
    const { judge, release } = jev("text");
    const differ = new SnapshotDiffer({ ...model, artefacts: judge });
    const reply = `${unclear}\n\n${long}`;
    differ.next({ messages: [message("r1", reply)], working: false });
    release();
    await vi.waitFor(() => expect(model.landed()).toBeGreaterThanOrEqual(1));
    const judged = differ.next({ messages: [message("r1", reply)], working: false }).messages[0]!;
    expect(judged.artifact).toBeUndefined();
    await vi.waitFor(() => expect(calls).toBe(1));
  });

  it("leads with the reply's own » summary and keeps the rest as the reply, without calling a model", () => {
    let calls = 0;
    const model = withModel(async () => (calls++, "x"));
    const differ = new SnapshotDiffer(model);
    const [rendered] = differ.next({ messages: [message("r1", `» Menu bar fixed.\n» Pushed.\n\n${long}`)], working: false }).messages;
    expect(rendered!.summary).toEqual({ html: "<p>Menu bar fixed. Pushed.</p>\n", source: "author" });
    expect(rendered!.html).not.toContain("Menu bar fixed");
    expect(calls).toBe(0);
  });

  it("shows a local digest while a model summary is on its way, then pushes the model's", async () => {
    let resolve!: (summary: string) => void;
    const model = withModel(() => new Promise((r) => (resolve = r)));
    const differ = new SnapshotDiffer(model);
    const snapshot = { messages: [message("short", "Done."), message("r1", long)], working: false };
    const first = differ.next(snapshot).messages;
    expect(first[0]!.summary).toBeUndefined();
    expect(first[1]!.summary).toMatchObject({ source: "digest", pending: true });
    expect(first[1]!.summary!.html).toContain("The menu bar now sits ten pixels higher");

    await new Promise((r) => setTimeout(r, 0));
    resolve("The menu bar is a little higher and saved, not yet published.");
    await new Promise((r) => setTimeout(r, 0));
    expect(model.landed()).toBe(1);
    const second = differ.next(snapshot).messages;
    expect(second.map((m) => m.id)).toEqual(["r1"]);
    expect(second[0]!.summary).toEqual({ html: "<p>The menu bar is a little higher and saved, not yet published.</p>\n", source: "model" });
  });

  it("leads a long reply with a few short lines of it, the rest behind more, when no model summary is coming", () => {
    const [rendered] = new SnapshotDiffer().next({ messages: [message("r1", long)], working: false }).messages;
    expect(rendered!.summary).toMatchObject({ source: "brief" });
    expect(rendered!.summary!.pending).toBeUndefined();
    expect(rendered!.summary!.html).toContain("The menu bar now sits ten pixels higher on every page, including the member login");
    expect(rendered!.summary!.html).toContain("the change is committed but not pushed yet");
  });

  it("never folds a reply that hands the captain something to act on behind its summary", () => {
    // The captain asked "what rules bro": the folded view showed "Kinsta won't
    // accept #." while the four rules he had to paste sat behind "more".
    const differ = new SnapshotDiffer();
    const [rendered, table] = differ.next({ messages: [message("r1", KINSTA_RULES), message("r3", KINSTA_TABLE)], working: false }).messages;
    // A few lines lead; the rules he has to paste show open under them, never folded behind "as written".
    expect(rendered).toMatchObject({ summary: { source: "brief" }, expanded: true });
    expect(rendered!.html).toContain("Set each to 301 and All domains");
    expect(rendered!.html).toContain("^/members-and-firms/?$");
    // The table too: its lines lead, the table shows open under them.
    expect(table).toMatchObject({ summary: { source: "brief" }, expanded: true });
    expect(table!.summary!.html).toContain("Add these in the dialog you showed");
    expect(table!.summary!.html).not.toBe(table!.html);
    expect(table!.html).toContain("https://capfive.com/professionals/");
    const [authored] = new SnapshotDiffer().next({ messages: [message("r2", `» Four rules for Kinsta.\n\n${KINSTA_RULES}`)], working: false }).messages;
    expect(authored).toMatchObject({ summary: { source: "author" }, expanded: true });
    expect(authored!.html).toContain("https://capfive.com/$1");
  });

  it("mutes routine chatter, and a reply the model finds routine shrinks to one line", async () => {
    const differ = new SnapshotDiffer(withModel(async () => "**ROUTINE.**"));
    const [shipshape] = differ.next({ messages: [message("r1", "Captain, shipshape.")], working: false }).messages;
    expect(shipshape).toMatchObject({ routine: true });
    const snapshot = { messages: [message("r2", long)], working: false };
    differ.next(snapshot);
    await new Promise((r) => setTimeout(r, 0));
    const [routine] = differ.next(snapshot).messages;
    expect(routine).toMatchObject({ routine: true, summary: { source: "model" } });
    expect(routine!.summary!.html).not.toContain("ROUTINE");
  });

  it("passes what the assistant is doing while it works, and nothing once it stops", () => {
    const differ = new SnapshotDiffer();
    expect(differ.next({ messages: [], working: true, activity: "Checking the About page on iPhone SE" }).activity).toBe("Checking the About page on iPhone SE");
    expect(differ.next({ messages: [], working: false, activity: "stale" }).activity).toBeUndefined();
  });

  it("only asks the model about the newest twenty replies, two at a time", async () => {
    let calls = 0;
    const model = withModel(() => (calls++, new Promise(() => {})));
    const messages = Array.from({ length: 25 }, (_unused, i) => message(`r${i}`, `${i} ${long}`));
    const rendered = new SnapshotDiffer(model).next({ messages, working: false }).messages;
    expect(rendered.map((m) => m.summary?.pending === true)).toEqual([...Array(5).fill(false), ...Array(20).fill(true)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });

  it("with always on, also asks the model about replies that carry their own summary, to compare", async () => {
    const model = withModel(async () => "Grok's take.");
    const differ = new SnapshotDiffer({ ...model, always: true });
    const snapshot = { messages: [message("r1", `» Menu bar fixed.\n\n${long}`)], working: false };
    expect(differ.next(snapshot).messages[0]!.compare).toEqual({ html: "", pending: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(differ.next(snapshot).messages[0]).toMatchObject({
      summary: { source: "author" },
      compare: { html: "<p>Grok&#39;s take.</p>\n" },
    });
  });
});

describe("ConversationViewServer", () => {
  let server: ConversationViewServer | null = null;
  let dir: string | null = null;
  let viewToken: string | undefined;

  afterEach(async () => {
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = null;
    dir = null;
    viewToken = undefined;
  });

  function get(port: number, path: string, host = `127.0.0.1:${port}`, authenticated = true): Promise<{ status: number; body: string; type?: string }> {
    return new Promise((resolve, reject) => {
      const streamPath = path.startsWith("/api/stream") && authenticated && viewToken
        ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(viewToken)}`
        : path;
      const req = request({ host: "127.0.0.1", port, path: streamPath, headers: { host } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          // The stream never ends; one update event is enough.
          if (path.startsWith("/api/stream") && body.includes("event: update")) {
            req.destroy();
            resolve({ status: res.statusCode ?? 0, body });
          }
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: res.headers["content-type"] }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  function post(port: number, body: string, headers: Record<string, string>, path = "/api/send"): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  /** In-memory stand-in for firstmate's inbox. */
  class MemoryInbox implements CaptainInbox {
    readonly sent: ConversationMessage[] = [];
    readonly uploads: unknown[] = [];
    readonly documents: unknown[] = [];
    async send(text: string, images: unknown[] = [], _command?: string, files: unknown[] = []) {
      this.uploads.push(...images);
      this.documents.push(...files);
      const message = { id: `note:${this.sent.length + 1}`, role: "user" as const, text, timestamp: new Date().toISOString() };
      this.sent.push(message);
      return { id: message.id, timestamp: message.timestamp! };
    }
    notes() {
      return this.sent.map((question) => ({ question, waiting: "passed to firstmate" }));
    }
    image() {
      return null;
    }
  }

  async function start(inbox?: CaptainInbox, lines = [captain("hello"), assistantText("Hi, **Captain**.")], predictions?: ComposerPredictions, drafts?: ComposerDrafts): Promise<number> {
    dir ??= mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    writeFileSync(join(dir, "s1.jsonl"), lines.join("\n") + "\n");
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, assistantLabel: "firstmate", ...(inbox ? { inbox } : {}) }), undefined, undefined, undefined, undefined, undefined, predictions, drafts ?? new ComposerDrafts({ root: join(dir, "drafts") }));
    const port = await server.listen(0);
    await get(port, "/");
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    return port;
  }

  const tokenOf = (page: string): string => /data-send-token="([0-9a-f]+)"/.exec(page)?.[1] ?? "";

  it("delivers an artefact decision to the durable inbox without a Claude session and never closes the hold", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-decision-server-"));
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data", "backlog.md"), `- [ ] visuals - Pick a Christmas look (repo: good_neighbours) (since ${new Date().toISOString().slice(0, 10)}) (hold: Choose Evergreen or a mix)\n`);
    writeFileSync(join(dir, "bin", "fm-bearings-snapshot.sh"), '#!/bin/sh\nprintf \'%s\' \'{"decisions_open":[{"id":"visuals","summary":"Pick a look"}]}\'\n', { mode: 0o755 });
    writeFileSync(join(dir, "bin", "fm-inbox.sh"), '#!/bin/sh\nmkdir -p "$FM_HOME/state/inbox"\ncat > "$FM_HOME/state/inbox/decision-note"\nprintf "queued decision-note\\n"\n', { mode: 0o755 });
    const feed = new ArtefactFeed({ home: dir, memoryFile: join(dir, "none"), newsFile: join(dir, "none"), tasteFile: join(dir, "none") });
    await feed.refresh();
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, inbox: new FirstmateInbox({ home: dir }) }), undefined, undefined, undefined, feed);
    const port = await server.listen(0);
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    const body = JSON.stringify({ decision: "visuals", text: "Evergreen luxe" });
    expect((await post(port, body, { "content-type": "application/json" })).status).toBe(403);
    expect((await post(port, body, { "content-type": "application/json", "x-flyd-view-token": viewToken!, origin: "https://evil.example" })).status).toBe(403);
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    const sent = await post(port, body, headers);
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({ id: "note:decision-note", waiting: "Sent to firstmate" });
    expect(readFileSync(join(dir, "state", "inbox", "decision-note"), "utf8")).toBe("Answer to pending decision visuals: Pick a Christmas look\nQuestion: Choose Evergreen or a mix\n\nEvergreen luxe");
    expect(feed.current().fleet!.calls).toHaveLength(1);
    expect((await post(port, JSON.stringify({ decision: "unknown", text: "Yes" }), headers)).status).toBe(409);
    expect((await post(port, JSON.stringify({ decision: "visuals", text: " " }), headers)).status).toBe(400);
    // Any artefact: his words go to firstmate naming what they are about.
    const about = await post(port, JSON.stringify({ about: { title: "Christmas Nuanu map", task: "gnm-xmas-map", url: "https://example.com/map" }, text: "Make the pins bigger" }), headers);
    expect(JSON.parse(about.body)).toMatchObject({ id: "note:decision-note", waiting: "Sent to firstmate" });
    expect(readFileSync(join(dir, "state", "inbox", "decision-note"), "utf8")).toBe('About the artefact "Christmas Nuanu map"\nTask: gnm-xmas-map\nPage: https://example.com/map\n\nMake the pins bigger');
    // A screenshot he pasted into the box goes with his words, saved where firstmate reads images.
    await post(port, JSON.stringify({ about: { title: "Christmas Nuanu map" }, text: "Like this", images: [{ mediaType: "image/png", data: PNG }] }), headers);
    const withImage = readFileSync(join(dir, "state", "inbox", "decision-note"), "utf8");
    expect(withImage).toMatch(/^About the artefact "Christmas Nuanu map"\n\nLike this\n\n\[image: (.+\.png)\]$/);
    expect(existsSync(/\[image: (.+)\]/.exec(withImage)![1]!)).toBe(true);
    // A picture alone says enough about an artefact; an answer to a decision still needs words.
    expect((await post(port, JSON.stringify({ about: { title: "Map" }, text: "", images: [{ mediaType: "image/png", data: PNG }] }), headers)).status).toBe(200);
    expect(readFileSync(join(dir, "state", "inbox", "decision-note"), "utf8")).toMatch(/^About the artefact "Map"\n\n\[image: .+\.png\]$/);
    expect((await post(port, JSON.stringify({ decision: "visuals", text: "", images: [{ mediaType: "image/png", data: PNG }] }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ about: { title: "Map" }, text: "Hi", images: "nope" }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ about: { task: "x" }, text: "Hi" }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ about: { title: "Map" }, text: "" }), headers)).status).toBe(400);
  });

  it("takes each held-up item's one action in Core, keeps the outcome and drops it from the list and its count", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-held-server-"));
    for (const sub of ["bin", "data", "state"]) mkdirSync(join(dir, sub));
    const gate = "Chief-of-staff mission contract + George-facing gate";
    writeFileSync(join(dir, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({ in_flight: [
      { id: "gate", state: "unknown", repo: "flyd", name: gate, doing: "Selected run code identity unverified; run ids: 01M56VVYX723WMFPQNNCPXZHVQ" },
      { id: "gate-again", state: "unknown", repo: "flyd", name: gate },
      { id: "pricing", state: "failed", name: "Pricing report" },
      { id: "hero", state: "paused", name: "Pick the hero image?" },
      { id: "migration", state: "failed", name: "Old migration" },
      { id: "ancient", state: "failed", name: "Ancient cleanup" },
    ] })}\nEOF\n`, { mode: 0o755 });
    writeFileSync(join(dir, "bin", "fm-inbox.sh"), '#!/bin/sh\nmkdir -p "$FM_HOME/state/inbox"\ncat > "$FM_HOME/state/inbox/held-note"\nprintf "queued held-note\\n"\n', { mode: 0o755 });
    const day = 86_400_000;
    for (const [task, age] of [["gate", day / 2], ["pricing", day / 4], ["hero", day / 8], ["migration", 10 * day], ["ancient", 40 * day]] as const) {
      writeFileSync(join(dir, "state", `${task}.status`), "stopped\n");
      const at = new Date(Date.now() - age);
      utimesSync(join(dir, "state", `${task}.status`), at, at);
    }
    const outcomes = join(dir, "held-outcomes.json");
    const feed = new ArtefactFeed({ home: dir, memoryFile: join(dir, "none"), newsFile: join(dir, "none"), tasteFile: join(dir, "none"), heldOutcomes: new HeldOutcomes(outcomes) });
    await feed.refresh();
    // A month-old hold and the same work listed twice are not his to sort through.
    expect(feed.current().fleet!.held.map((row) => row.task).sort()).toEqual(["gate", "hero", "migration", "pricing"]);
    expect(fleetCounts(feed.current().fleet).waiting).toBe(4);
    const items = heldItems(feed.current().fleet, { project: (repo) => (repo === "flyd" ? "Flyd" : undefined) });
    expect(items.map((item) => [item.task, item.action])).toEqual([["hero", "reply"], ["pricing", "act"], ["gate", "act"], ["migration", "dismiss"]]);
    const gateItem = items.find((item) => item.task === "gate")!;
    expect(gateItem.headline).toBe("“Chief-of-staff mission contract and George-facing gate” has gone quiet.");
    expect(gateItem.why).toBe("Nobody is moving it forward, so Flyd can check on it and get it going again.");
    expect(`${gateItem.headline} ${gateItem.why}`).not.toMatch(/01M56|run ids|no word/);
    expect(gateItem.detail).toContain("01M56VVYX723WMFPQNNCPXZHVQ");

    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, inbox: new FirstmateInbox({ home: dir }) }), undefined, undefined, undefined, feed);
    const port = await server.listen(0);
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    const choose = (id: string, action: string, sent: Record<string, string> = headers) => post(port, JSON.stringify({ id, action }), sent, "/api/held");
    expect((await choose(gateItem.id, "act", { "content-type": "application/json" })).status).toBe(403);
    expect((await choose("waiting:held-nothing", "dismiss")).status).toBe(409);
    expect((await choose(gateItem.id, "shout")).status).toBe(409);

    expect((await choose(gateItem.id, "act")).status).toBe(200);
    expect(readFileSync(join(dir, "state", "inbox", "held-note"), "utf8")).toMatch(/^George asks you to pick up held-up task gate: Chief-of-staff mission contract \+ George-facing gate \(no word\)\.\nLast word: .*01M56VVYX723WMFPQNNCPXZHVQ[\s\S]*Restart or continue it/);
    expect((await choose(items.find((item) => item.task === "pricing")!.id, "save")).status).toBe(409);
    expect((await choose(items.find((item) => item.task === "pricing")!.id, "act")).status).toBe(200);
    expect(readFileSync(join(dir, "state", "inbox", "held-note"), "utf8")).toMatch(/^George asks you to pick up held-up task pricing: Pricing report \(failed\)\./);
    expect(items.find((item) => item.task === "pricing")!.why).toBe("It stopped with an error, so nothing moves until Flyd restarts it.");
    expect((await choose(items.find((item) => item.task === "hero")!.id, "reply")).status).toBe(200);
    expect((await choose(items.find((item) => item.task === "migration")!.id, "dismiss")).status).toBe(200);

    // Gone from the list and its count, the duplicate with it, and still gone after a fresh read and a restart.
    await feed.refresh();
    expect(feed.current().fleet!.held).toEqual([]);
    expect(fleetCounts(feed.current().fleet).waiting).toBe(0);
    expect((await choose(gateItem.id, "act")).status).toBe(409);
    const reread = new ArtefactFeed({ home: dir, memoryFile: join(dir, "none"), newsFile: join(dir, "none"), tasteFile: join(dir, "none"), heldOutcomes: new HeldOutcomes(outcomes) });
    await reread.refresh();
    expect(reread.current().fleet!.held).toEqual([]);
    // Work that reports again after he chose comes back to him.
    utimesSync(join(dir, "state", "migration.status"), new Date(), new Date());
    await reread.refresh();
    expect(reread.current().fleet!.held.map((row) => row.task)).toEqual(["migration"]);
  });

  it("says whether firstmate has read a note he sent from an artefact, only with the view's token", async () => {
    const inbox = new MemoryInbox();
    await inbox.send("Make the pins bigger");
    await inbox.send("And the labels");
    const notes = inbox.notes.bind(inbox);
    inbox.notes = () => notes().map((exchange) => ({ ...exchange, question: { ...exchange.question, receipt: exchange.question.id === "note:1" ? "read" as const : "sent" as const } }));
    const port = await start(inbox);
    const receipt = async (id: string) => JSON.parse((await get(port, `/api/note?id=${encodeURIComponent(id)}&token=${viewToken}`)).body).receipt;
    expect(await receipt("note:1")).toBe("read");
    expect(await receipt("note:2")).toBe("sent");
    expect(await receipt("note:9")).toBeNull();
    expect((await get(port, "/api/note?id=note%3A1")).status).toBe(403);
  });

  it("returns the reply about a note he sent from an artefact, so it can land in the card's own thread", async () => {
    const inbox = new MemoryInbox();
    await inbox.send("Make the pins bigger");
    const notes = inbox.notes.bind(inbox);
    inbox.notes = () => notes().map((exchange) => exchange.question.id !== "note:1" ? exchange : {
      ...exchange,
      waiting: "",
      answer: { id: "note-reply:1", role: "assistant" as const, text: "Bigger pins it is, sir.", timestamp: "2026-10-05T20:03:00.000Z", answers: "note:1" },
    });
    const port = await start(inbox);
    const note = async (id: string) => JSON.parse((await get(port, `/api/note?id=${encodeURIComponent(id)}&token=${viewToken}`)).body);
    expect(await note("note:1")).toEqual({ receipt: "read", answer: { text: "Bigger pins it is, sir.", timestamp: "2026-10-05T20:03:00.000Z" } });
    expect(await note("note:9")).toEqual({ receipt: null });
  });

  it("keeps a note firstmate took but has not answered open, so a later reply still lands", async () => {
    const inbox = new MemoryInbox();
    await inbox.send("Make the pins bigger");
    const notes = inbox.notes.bind(inbox);
    inbox.notes = () => notes().map((exchange) => ({ ...exchange, handoff: "taken" as const, takenAt: "2026-10-05T20:03:00.000Z" }));
    const port = await start(inbox);
    const note = JSON.parse((await get(port, `/api/note?id=${encodeURIComponent("note:1")}&token=${viewToken}`)).body);
    // Taken, so the line under the box says Flyd has it — but never that the card should stop
    // asking: a taken note can still be answered in firstmate's own chat, so no `done` is sent.
    expect(note).toEqual({ receipt: "read" });
  });

  it("finds a note's chat reply in the session that was live when he sent it, not only the newest", async () => {
    const inbox = new MemoryInbox();
    await inbox.send("Make the pins bigger");
    const notes = inbox.notes.bind(inbox);
    // Sent while the first session was live.
    inbox.notes = () => notes().map((exchange) => ({ ...exchange, question: { ...exchange.question, timestamp: "2026-10-05T17:00:03.000Z" } }));
    const port = await start(inbox, [
      captain("hello", { timestamp: "2026-10-05T17:00:00.000Z" }),
      assistantText("The pins on the map are bigger now, sir, and the labels are ready.", "end_turn", { timestamp: "2026-10-05T17:00:04.000Z" }),
    ]);
    // A newer session has started since, and firstmate said nothing in it about this note.
    writeFileSync(join(dir!, "s2.jsonl"), [captain("later", { timestamp: "2026-10-05T17:10:00.000Z" }), assistantText("Sure, on it.", "end_turn", { timestamp: "2026-10-05T17:10:01.000Z" })].join("\n") + "\n");
    const note = JSON.parse((await get(port, `/api/note?id=${encodeURIComponent("note:1")}&token=${viewToken}`)).body);
    expect(note.answer?.timestamp).toBe("2026-10-05T17:00:04.000Z");
    expect(note.answer?.text).toContain("pins on the map are bigger");
  });

  it("sends his reply to an answer back to firstmate, saying what it answers, and threads it under that answer", async () => {
    const inbox = new MemoryInbox();
    await inbox.send("There should also be other movements for bunny.");
    const answered = inbox.notes.bind(inbox);
    inbox.notes = () => answered().map((exchange) => exchange.question.id !== "note:1" ? exchange : {
      ...exchange,
      waiting: "",
      answer: { id: "note-reply:1", role: "assistant" as const, text: "Clicking the bunny now makes him jump. Each click picks a new move.", timestamp: new Date().toISOString(), answers: "note:1", shots: ["/tmp/bunny.png"] },
    });
    const port = await start(inbox);
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    const sent = await post(port, JSON.stringify({ session: "s1", text: "Make the spin slower.", replyTo: "note:1" }), headers);
    expect(sent.status).toBe(200);
    expect(inbox.sent[1]!.text).toBe('[Captain is replying from Flyd to note:1 — his note: "There should also be other movements for bunny."; your answer began: "Clicking the bunny now makes him jump."; the answer\'s screenshot: /tmp/bunny.png. His reply follows.]\n\nMake the spin slower.');
    const reply = server!["source"].exchanges!().find((exchange: { question: ConversationMessage }) => exchange.question.id === "note:2")!;
    expect(reply.question).toMatchObject({ text: "Make the spin slower.", replyTo: "note:1", replyQuote: "There should also be other movements for bunny." });
    expect((await post(port, JSON.stringify({ session: "s1", text: "Hm", replyTo: "note:9" }), headers)).status).toBe(409);
    expect((await post(port, JSON.stringify({ session: "s1", text: " ", replyTo: "note:1" }), headers)).status).toBe(400);
  });

  it("sends his answer to a question firstmate put in its own session back to that session, quoting the question", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox, [
      captain("ok do it"),
      assistantText("Captain, I checked the form. The leftover test page is still there. Should I remove it?"),
      captain("thanks"),
      assistantText("All three are live now, and the form feels firmer on a phone."),
    ]);
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    const messages: ConversationMessage[] = (await server!["source"].read("s1")).messages;
    const [asked, reported] = messages.filter((message) => message.role === "assistant");
    const sent = await post(port, JSON.stringify({ session: "s1", text: "Yes", replyTo: asked!.id }), headers);
    expect(sent.status).toBe(200);
    expect(inbox.sent[0]!.text).toBe(`[Captain is replying from Flyd to ${asked!.id} — your question: "The leftover test page is still there. Should I remove it?"; your reply began: "I checked the form.". His answer follows.]\n\nYes`);
    // In the window and the column it reads as his own word, answering that question.
    const answer = server!["source"].exchanges!()[0]!;
    expect(answer.question).toMatchObject({ text: "Yes", replyTo: asked!.id, replyQuote: "The leftover test page is still there. Should I remove it?" });
    // A reply that asked nothing is not a question to answer.
    expect((await post(port, JSON.stringify({ session: "s1", text: "Yes", replyTo: reported!.id }), headers)).status).toBe(409);
  });

  it("answers firstmate's routine question for him by his standing rule, shows it as Flyd's, and takes it back on Undo", async () => {
    const inbox = new MemoryInbox();
    dir = mkdtempSync(join(tmpdir(), "flyd-auto-answer-"));
    const asked = new Date().toISOString();
    writeFileSync(join(dir, "s1.jsonl"), [
      captain("land the notes fix when it's green"),
      assistantText("The notes-read change is done and its checks are green: https://github.com/GeorgeGally/flyd/pull/122\n\nShould I merge it?", "end_turn", { timestamp: asked }),
    ].join("\n") + "\n");
    const auto = new AutoAnswers({ preferences: () => "- Merge green Flyd PRs without asking — land the work and tell him after, not before. (2026-10-10)", logFile: join(dir, "auto.jsonl") });
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, assistantLabel: "firstmate", inbox }), undefined, undefined, undefined, undefined, undefined, undefined, new ComposerDrafts({ root: join(dir, "drafts") }), undefined, undefined, auto);
    const port = await server.listen(0);
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    await get(port, "/api/stream");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(inbox.sent.map((note) => note.text)).toEqual([expect.stringMatching(/^\[Flyd is answering for the captain to reply:.+ — your question: "Should I merge it\?"; by his standing rule: "Merge green Flyd PRs without asking/)]);
    // In the window: no card, and a line saying Flyd answered, by which rule.
    const differ = new SnapshotDiffer();
    const shown = differ.next(await server!["source"].read("s1")).messages;
    expect(shown.find((message) => message.role === "assistant" && message.id.startsWith("reply:"))!.choice).toBeUndefined();
    expect(shown.find((message) => message.id === "note:1")).toMatchObject({ answeredFor: "Merge green Flyd PRs without asking" });
    // Undo: the session is told to hold off, and the question is his again.
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    expect((await post(port, JSON.stringify({ session: "s1", undo: "note:1" }), headers)).status).toBe(200);
    expect(inbox.sent[1]!.text).toMatch(/he takes back the answer Flyd gave for him \("Yes"\)/);
    const again = differ.next(await server!["source"].read("s1")).messages;
    expect(again.find((message) => message.id === "note:1")).toMatchObject({ undone: true });
    expect(again.find((message) => message.role === "assistant" && message.id.startsWith("reply:"))!.choice).toMatchObject({ question: "Should I merge it?", options: ["Yes", "No"] });
    // Only an answer Flyd gave can be taken back.
    expect((await post(port, JSON.stringify({ session: "s1", undo: "note:2" }), headers)).status).toBe(409);
  });

  it("sends his comment on a spot of the phone preview to firstmate, with the page, viewport and spot", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    const comment = { url: "http://127.0.0.1:8088/index.html#location", x: 120.4, y: 300, element: "a.cta “Plan your visit”", text: "Full width on phones." };
    const sent = await post(port, JSON.stringify({ session: "s1", comment }), headers);
    expect(sent.status).toBe(200);
    expect(inbox.sent[0]!.text).toBe("Comment on the phone preview of http://127.0.0.1:8088/index.html#location (390×844 viewport), at x 120, y 300 of the screen, on a.cta “Plan your visit”:\n\nFull width on phones.");
    // Only a local page, a spot on the screen, and words.
    expect((await post(port, JSON.stringify({ session: "s1", comment: { ...comment, url: "https://example.com/" } }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", comment: { ...comment, x: 900 } }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", comment: { ...comment, text: " " } }), headers)).status).toBe(400);
    expect(inbox.sent).toHaveLength(1);
  });

  it("sends his comment on words he selected to firstmate, quoting them and naming the conversation", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
    const sent = await post(port, JSON.stringify({ session: "s1", passage: { quote: "Hi, Captain.", from: "assistant" }, text: "Too formal." }), headers);
    expect(sent.status).toBe(200);
    expect(inbox.sent[0]!.text).toMatch(/^Comment on a passage of \w+'s reply in the conversation (?:"[^"]+" \(session s1\)|session s1):\n\n> Hi, Captain\.\n\nToo formal\.$/);
    // A passage of a message, whose it was, and words.
    expect((await post(port, JSON.stringify({ session: "s1", passage: { quote: " ", from: "assistant" }, text: "x" }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", passage: { quote: "x".repeat(2001), from: "user" }, text: "x" }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", passage: { quote: "Hi", from: "someone" }, text: "x" }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", passage: { quote: "Hi", from: "user" }, text: " " }), headers)).status).toBe(400);
    expect(inbox.sent).toHaveLength(1);
  });

  it("lets the page frame a loopback preview for the right column, and no other origin", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-csp-"));
    const source = {
      assistantLabel: "Flyd",
      canSend: false,
      listSessions: async () => [],
      read: async () => ({ messages: [], working: false }),
      follow: (_id: string, onUpdate: (s: { messages: never[]; working: boolean }) => void) => {
        onUpdate({ messages: [], working: false });
        return { close() {} };
      },
      commands: async () => [],
      image: async () => null,
    };
    server = new ConversationViewServer(source as never);
    const port = await server.listen(0);
    const csp = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        resolve(String(res.headers["content-security-policy"]));
        res.resume();
      });
      req.on("error", reject);
      req.end();
    });
    expect(csp).toContain("frame-src 'self' http://127.0.0.1:*");
    expect(csp).not.toContain("frame-src *");
  });

  it("serves a local screenshot a reply named, only from firstmate's tree or Flyd's", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-rail-image-"));
    const shot = join(dir, "data", "task", "after.png");
    mkdirSync(join(dir, "data", "task"), { recursive: true });
    writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const outside = join(mkdtempSync(join(tmpdir(), "flyd-outside-")), "secret.png");
    writeFileSync(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const prev = process.env.FLYD_FIRSTMATE_HOME;
    process.env.FLYD_FIRSTMATE_HOME = dir;
    try {
      const source = {
        assistantLabel: "Flyd",
        canSend: false,
        listSessions: async () => [],
        read: async () => ({ messages: [], working: false }),
        follow: (_id: string, onUpdate: (s: { messages: never[]; working: boolean }) => void) => {
          onUpdate({ messages: [], working: false });
          return { close() {} };
        },
        commands: async () => [],
        image: async () => null,
      };
      server = new ConversationViewServer(source as never);
      const port = await server.listen(0);
      const token = JSON.parse((await get(port, "/api/token")).body).token as string;
      const inside = await get(port, `/api/rail-image?path=${encodeURIComponent(shot)}&token=${token}`);
      expect(inside.status).toBe(200);
      expect(inside.type).toBe("image/png");
      const blocked = await get(port, `/api/rail-image?path=${encodeURIComponent(outside)}&token=${token}`);
      expect(blocked.status).toBe(403);
      expect((await get(port, `/api/rail-image?path=${encodeURIComponent(shot)}`)).status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.FLYD_FIRSTMATE_HOME;
      else process.env.FLYD_FIRSTMATE_HOME = prev;
    }
  });

  it("serves a deliverable or review board page from firstmate's data tree, sandboxed, behind the token in its path", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-rail-file-"));
    mkdirSync(join(dir, "data", "gnm-decks", "review"), { recursive: true });
    writeFileSync(join(dir, "data", "gnm-decks", "review.html"), "<title>GNM Sponsor Decks</title><img src=\"review/a.png\">");
    writeFileSync(join(dir, "data", "gnm-decks", "review", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, "data", "gnm-decks", "deck.pdf"), "%PDF-1.4");
    writeFileSync(join(dir, "secret.html"), "<p>not data</p>");
    const prev = process.env.FLYD_FIRSTMATE_HOME;
    process.env.FLYD_FIRSTMATE_HOME = dir;
    try {
      const source = {
        assistantLabel: "Flyd",
        canSend: false,
        listSessions: async () => [],
        read: async () => ({ messages: [], working: false }),
        follow: (_id: string, onUpdate: (s: { messages: never[]; working: boolean }) => void) => {
          onUpdate({ messages: [], working: false });
          return { close() {} };
        },
        commands: async () => [],
        image: async () => null,
      };
      server = new ConversationViewServer(source as never);
      const port = await server.listen(0);
      const token = JSON.parse((await get(port, "/api/token")).body).token as string;
      const base = `http://127.0.0.1:${port}/rail-file/${token}`;
      const page = await fetch(`${base}${dir}/data/gnm-decks/review.html`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
      expect(page.headers.get("content-security-policy")).not.toContain("allow-same-origin");
      expect((await fetch(`${base}${dir}/data/gnm-decks/review/a.png`)).headers.get("content-type")).toBe("image/png");
      const pdf = await fetch(`${base}${dir}/data/gnm-decks/deck.pdf`);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect((await fetch(`${base}${dir}/secret.html`)).status).toBe(403);
      expect((await fetch(`${base}${dir}/data/gnm-decks/../../secret.html`)).status).toBe(403);
      expect((await fetch(`http://127.0.0.1:${port}/rail-file/wrong${dir}/data/gnm-decks/review.html`)).status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.FLYD_FIRSTMATE_HOME;
      else process.env.FLYD_FIRSTMATE_HOME = prev;
    }
  });

  it("authenticates predictions, uses current conversation context and never dispatches the suggestion", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-prediction-server-"));
    let calls = 0, prompt = "";
    const predictions = new ComposerPredictions({ root, provider: async (p) => { calls++; prompt = p; return { text: " and check the tests" }; } });
    const inbox = new MemoryInbox();
    try {
      const port = await start(inbox, [captain("change the composer"), assistantText("I can do that.")], predictions);
      const body = JSON.stringify({ session: "s1", draft: "implement it" });
      const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
      expect((await post(port, body, { "content-type": "application/json" }, "/api/predict")).status).toBe(403);
      expect((await post(port, body, { ...headers, origin: "https://evil.example" }, "/api/predict")).status).toBe(403);
      expect(calls).toBe(0);
      const reply = await post(port, body, headers, "/api/predict");
      expect(reply.status).toBe(200); expect(JSON.parse(reply.body).prediction.suffix).toBe(" and check the tests");
      expect(prompt).toContain("change the composer"); expect(prompt).toContain("implement it"); expect(inbox.sent).toEqual([]);
      expect((await get(port, "/api/prediction-status")).status).toBe(403);
      expect((await get(port, "/api/prediction-status?token=" + viewToken)).status).toBe(200);
      expect((await post(port, JSON.stringify({ session: "s1", draft: "x".repeat(2001) }), headers, "/api/predict")).status).toBe(400);
    } finally { predictions.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("bases the next prediction on a message just sent and its reply", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-prediction-fresh-"));
    let prompt = "", clock = Date.now();
    // Each guess is a minute apart: well inside the old five-minute cache, clear of the request throttle.
    const predictions = new ComposerPredictions({ root, now: () => (clock += 60_000), provider: async (p) => { prompt = p; return { text: " and check the tests" }; } });
    const inbox = new MemoryInbox();
    try {
      const port = await start(inbox, [captain("change the composer"), assistantText("I can do that.")], predictions);
      const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
      expect((await post(port, JSON.stringify({ session: "s1", draft: "implement it" }), headers, "/api/predict")).status).toBe(200);
      expect(prompt).not.toContain("rename the footer");
      expect((await post(port, JSON.stringify({ session: "s1", text: "rename the footer" }), headers)).status).toBe(200);
      appendFileSync(join(dir!, "s1.jsonl"), assistantText("Renamed it to Colophon.") + "\n");
      expect((await post(port, JSON.stringify({ session: "s1", draft: "now move it" }), headers, "/api/predict")).status).toBe(200);
      expect(prompt).toContain("rename the footer");
      expect(prompt).toContain("Renamed it to Colophon.");
    } finally { predictions.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("serves the page, sessions and a rendered stream on loopback", async () => {
    const port = await start();
    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>firstmate</title>");

    const sessions = JSON.parse((await get(port, "/api/sessions")).body);
    expect(sessions.sessions.map((s: { id: string }) => s.id)).toEqual(["s1"]);

    const stream = await get(port, "/api/stream");
    expect(stream.body).toContain("event: session");
    const update = JSON.parse(stream.body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.messages.map((m: { html: string }) => m.html)).toEqual(["<p>hello</p>\n", "<p>Hi, <strong>Captain</strong>.</p>\n"]);
  });

  it("streams Flyd's own activity for the left column, and not at all without a reader", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-view-activity-"));
    const home = join(dir, "flyd-home");
    mkdirSync(join(home, "logs"), { recursive: true });
    writeFileSync(join(home, "logs", "agenda.log"), `${new Date(Date.now() - 5 * 60_000).toISOString()} scout: watch: 0 must-know\n`);
    writeFileSync(join(dir, "s1.jsonl"), [captain("hello"), assistantText("Hi.")].join("\n") + "\n");
    const source = () => new ClaudeCodeTranscriptSource({ projectDir: dir!, assistantLabel: "firstmate" });
    server = new ConversationViewServer(source(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new ActivityReader({ dir: home }));
    const port = await server.listen(0);
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    const update = JSON.parse((await get(port, "/api/stream")).body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.leftColumn.now).toEqual([]);
    expect(update.leftColumn.recent).toMatchObject([{ title: "Watched the news for you", line: "Nothing urgent." }]);
    await server.close();

    server = new ConversationViewServer(source());
    const bare = await server.listen(0);
    viewToken = JSON.parse((await get(bare, "/api/token")).body).token;
    const without = JSON.parse((await get(bare, "/api/stream")).body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(without.leftColumn).toBeUndefined();
  });

  it("rejects an unauthenticated stream before exposing artefact data", async () => {
    const port = await start();
    expect((await get(port, "/api/stream", `127.0.0.1:${port}`, false)).status).toBe(403);
  });

  it("streams each note's receipt, saying nothing over the composer about notes left waiting", async () => {
    const inbox = new MemoryInbox();
    const old = new Date(Date.now() - 12 * 60_000).toISOString();
    inbox.notes = () => [
      { question: { id: "note:1", role: "user" as const, text: "fix the footer", timestamp: old, receipt: "sent" as const }, handoff: "queued" as const, waiting: "Working on it" },
      { question: { id: "note:2", role: "user" as const, text: "and the header", timestamp: old, receipt: "read" as const }, handoff: "taken" as const, waiting: "Working on it" },
    ];
    const port = await start(inbox);
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/stream?token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: update")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const update = JSON.parse(body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    const receipts = Object.fromEntries(update.messages.filter((m: { receipt?: string }) => m.receipt).map((m: { id: string; receipt: string }) => [m.id, m.receipt]));
    expect(receipts).toEqual({ "note:1": "sent", "note:2": "read" });
    // Notes left waiting are Flyd's to chase: no unread warning over the composer.
    expect(body).not.toContain("event: unread");
  });

  it("lists a reply's steps in the column's Artefacts once, as the window points to them", async () => {
    const inbox = new MemoryInbox();
    const lines = [captain("hello"), assistantText("Hi, **Captain**.")];
    const old = new Date(Date.parse(JSON.parse(lines[0]!).timestamp) + 500).toISOString();
    const reply = "Captain, fix the aicanetwork.com redirects.\n\n1. In MyKinsta, delete the ^/$ rule.\n2. Then add ^/(.*)$ → https://capfive.com/$1 as a 301.";
    inbox.notes = () => [{
      question: { id: "note:1791720009-eeeeee", role: "user" as const, text: "so what do i do here?", timestamp: old, receipt: "read" as const },
      handoff: "queued" as const,
      waiting: "",
      answer: { id: "note-reply:1791720009-eeeeee", role: "assistant" as const, text: reply, answers: "note:1791720009-eeeeee" },
    }];
    const port = await start(inbox, lines);
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/stream?token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: update")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const update = JSON.parse(body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    const cards = update.rail.artefacts.filter((card: { id: string }) => card.id.startsWith("reply:"));
    expect(cards).toEqual([{ id: "reply:note-reply:1791720009-eeeeee", title: "Fix the aicanetwork.com redirects", steps: ["In MyKinsta, delete the ^/$ rule.", "Then add ^/(.*)$ → https://capfive.com/$1 as a 301."] }]);
    const rendered = update.messages.find((m: { id: string }) => m.id === "note-reply:1791720009-eeeeee");
    expect(rendered?.artifact?.title).toBe("Fix the aicanetwork.com redirects");
    expect(rendered?.summary?.html).toContain("2 steps, kept in Artefacts.");
    expect(rendered?.expanded).toBeUndefined();
  });

  it("keeps the newest replies' steps in the column's Artefacts, newest first", async () => {
    const how = (n: number) => assistantText(`Captain, fix site ${n}.\n\n1. Delete rule ${n}.\n2. Add rule ${n}.`);
    const port = await start(undefined, [captain("one"), how(1), captain("two"), how(2), captain("three"), how(3), captain("four"), how(4)]);
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/stream?token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: update")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const update = JSON.parse(body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    const titles = update.rail.artefacts.filter((card: { id: string }) => card.id.startsWith("reply:")).map((card: { title: string }) => card.title);
    expect(titles).toEqual(["Fix site 4", "Fix site 3", "Fix site 2"]);
    // The window points only those replies to Artefacts; the oldest is told as text.
    const pointed = update.messages.filter((m: { artifact?: { title: string } }) => m.artifact).map((m: { artifact: { title: string } }) => m.artifact.title);
    expect(pointed).toEqual(["Fix site 2", "Fix site 3", "Fix site 4"]);
    expect(JSON.stringify(update.messages)).not.toContain("Fix site 1</strong>: 2 steps, kept in Artefacts");
  });

  const askedNote = (id: string, text: string, answer: string, timestamp = new Date().toISOString()): Exchange => ({
    question: { id: `note:${id}`, role: "user" as const, text, timestamp, receipt: "read" as const },
    handoff: "queued" as const,
    waiting: "",
    answer: { id: `note-reply:${id}`, role: "assistant" as const, text: answer, answers: `note:${id}` },
  });

  it("asks firstmate for the artefact a note expected but did not get, in Flyd's own words", async () => {
    const inbox = new MemoryInbox();
    inbox.notes = () => [askedNote("1791720009-aaaaaa", "explain the new Flyd commits in an artefact", "The new commits add routine artefacts and tidy the island.")];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(1);
    expect(inbox.sent[0]!.text).toContain("[Flyd is asking for the artefact to note:1791720009-aaaaaa — his note: \"explain the new Flyd commits in an artefact\"");
    expect(inbox.sent[0]!.text).toContain("Flyd: send that as an artefact");
  });

  it("asks for no artefact when the note did not ask for one, or the answer already carries one", async () => {
    const prose = new MemoryInbox();
    prose.notes = () => [askedNote("1791720009-bbbbbb", "so what do i do here?", "Delete the catch-all, then add the general rule.")];
    const prosePort = await start(prose, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(prosePort, "/api/stream");
    expect(prose.sent).toHaveLength(0);

    const steps = new MemoryInbox();
    steps.notes = () => [askedNote("1791720009-cccccc", "explain the redirects in an artefact", "Captain, the redirects:\n\n1. Delete the ^/$ rule.\n2. Add ^/(.*)$ → https://capfive.com/$1 as a 301.")];
    const stepsPort = await start(steps, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(stepsPort, "/api/stream");
    expect(steps.sent).toHaveLength(0);
  });

  it("never asks for an artefact over a note that only mentions one, or Flyd's own chase", async () => {
    const inbox = new MemoryInbox();
    const prose = "Here is the summary of what changed.";
    const alreadyChased = artefactAsk(askedNote("1791720009-zzzzzz", "explain the commits in an artefact", "A summary."));
    inbox.notes = () => [
      askedNote("1791720009-aaaaaa", "explain why the artefact page is blank", prose),
      askedNote("1791720009-bbbbbb", "show me where the artefact went", prose),
      askedNote("1791720009-cccccc", "can you make a note about the artefact feature", prose),
      askedNote("1791720009-dddddd", "write up the artefact problem", prose),
      { question: { id: "note:1791720009-eeeeee", role: "user" as const, text: alreadyChased, timestamp: new Date().toISOString(), receipt: "read" as const }, handoff: "queued" as const, waiting: "", answer: { id: "note-reply:1791720009-eeeeee", role: "assistant" as const, text: "Noted.", answers: "note:1791720009-eeeeee" } },
    ];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(0);
  });

  it("asks for the artefact a note asked as its deliverable, exactly once, and not again when the window reopens", async () => {
    const inbox = new MemoryInbox();
    inbox.notes = () => [askedNote("1791720009-aaaaaa", "pull and check and then explain in an artefact what they do", "They pull, check and explain the commits.")];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(1);
    const chased = inbox.sent[0]!;
    // The chase lands in the transcript too; reopening the window reads it back and asks no more.
    inbox.notes = () => [askedNote("1791720009-aaaaaa", "pull and check and then explain in an artefact what they do", "They pull, check and explain the commits."), { question: chased, handoff: "queued" as const, waiting: "" }];
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(1);
  });

  it("chases at most one missed artefact per pass, so a backlog never arrives as a burst", async () => {
    const inbox = new MemoryInbox();
    inbox.notes = () => [
      askedNote("1791720009-aaaaaa", "explain the new Flyd commits in an artefact", "A short summary."),
      askedNote("1791720009-bbbbbb", "explain the redirect rules in an artefact", "Another short summary."),
    ];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(1);
  });

  it("hides Flyd's own chase for a missed artefact, so no window message reads as his", async () => {
    const inbox = new MemoryInbox();
    const asked = askedNote("1791720009-aaaaaa", "explain the new Flyd commits in an artefact", "The new commits add routine artefacts and tidy the island.");
    inbox.notes = () => [asked];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(1);
    const chase = inbox.sent[0]!;
    // The chase lands in firstmate's inbox; the window reads it back on the next pass.
    inbox.notes = () => [asked, { question: chase, handoff: "queued" as const, waiting: "" }];
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/stream?token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: update")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const update = JSON.parse(body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.messages.map((m: { id: string }) => m.id)).not.toContain(chase.id);
    const shown = update.messages.filter((m: { role: string }) => m.role === "user").map((m: { html: string }) => m.html).join("\n");
    expect(shown).not.toContain("send that as an artefact");
    // The Artefacts/Conversations column never shows the chase either.
    expect(update.rail.conversations.map((talk: { id: string }) => talk.id)).not.toContain(chase.id);
    expect(JSON.stringify(update.rail)).not.toContain("send that as an artefact");
  });

  it("does not chase again for a note already chased in an earlier session", async () => {
    const inbox = new MemoryInbox();
    const asked = askedNote("1791720009-aaaaaa", "pull and check and then explain in an artefact what they do", "They pull, check and explain the commits.");
    inbox.notes = () => [asked, { question: { id: "note:1791720009-ffff", role: "user" as const, text: artefactAsk(asked), timestamp: new Date().toISOString(), receipt: "read" as const }, handoff: "queued" as const, waiting: "" }];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(0);
  });

  it("does not chase a note asked for more than a day ago", async () => {
    const inbox = new MemoryInbox();
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    inbox.notes = () => [askedNote("1791720009-aaaaaa", "explain the commits in an artefact", "A summary.", old)];
    const port = await start(inbox, [captain("hello"), assistantText("Hi, **Captain**.")]);
    await get(port, "/api/stream");
    expect(inbox.sent).toHaveLength(0);
  });

  it("never warns about a note firstmate answered in its own chat, answered formally, or is working on now", async () => {
    const inbox = new MemoryInbox();
    const lines = [
      captain("<task-notification> watcher wake </task-notification>"),
      assistantText("Done, sir: the footer links are fixed and the footer spacing is tighter now."),
      captain("<task-notification> watcher wake </task-notification>"),
      toolUse("Read", { file_path: "/Users/george/Documents/firstmate/state/inbox/1791720003-cccccc.note" }),
    ];
    // Sent early in firstmate's session and left in its inbox: firstmate files a note only once it is done with it.
    const old = new Date(Date.parse(JSON.parse(lines[0]!).timestamp) + 500).toISOString();
    const sent = (id: string, text: string) => ({ question: { id: `note:${id}`, role: "user" as const, text, timestamp: old, receipt: "sent" as const }, handoff: "queued" as const, waiting: "Working on it" });
    inbox.notes = () => [
      sent("1791720001-aaaaaa", "fix the footer links spacing"),
      { ...sent("1791720002-bbbbbb", "rename the pricing tab"), answer: { id: "note-reply:1791720002-bbbbbb", role: "assistant" as const, text: "Renamed it to Plans.", answers: "note:1791720002-bbbbbb" }, waiting: "" },
      sent("1791720003-cccccc", "make the hero image bigger"),
      sent("1791720004-dddddd", "check the contact form"),
    ];
    const port = await start(inbox, lines);
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/stream?token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: update")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const update = JSON.parse(body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    const receipts = Object.fromEntries(update.messages.filter((m: { receipt?: string }) => m.receipt).map((m: { id: string; receipt: string }) => [m.id, m.receipt]));
    expect(receipts).toEqual({
      "note:1791720001-aaaaaa": "read",
      "note:1791720002-bbbbbb": "read",
      "note:1791720003-cccccc": "read",
      "note:1791720004-dddddd": "sent",
    });
    // The column shows each note's own recorded answer, never a chat paragraph that seemed to be about it.
    const rows = Object.fromEntries(update.rail.conversations.map((talk: { id: string; answer?: string; state?: string }) => [talk.id, [talk.answer, talk.state]]));
    expect(rows["note:1791720001-aaaaaa"]).toEqual([undefined, "done"]);
    expect(rows["note:1791720002-bbbbbb"]).toEqual(["Renamed it to Plans.", "done"]);
    expect(rows["note:1791720004-dddddd"]).toEqual([undefined, "underway"]);
    expect(JSON.stringify(update.rail)).not.toContain("footer links are fixed");
  });

  it("counts a note a crewmate is working on as read by firstmate", () => {
    dir ??= mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    const inbox = new MemoryInbox();
    const old = new Date(Date.now() - 12 * 60_000).toISOString();
    inbox.notes = () => [
      { question: { id: "note:1", role: "user" as const, text: "fix the footer", timestamp: old, receipt: "sent" as const }, handoff: "queued" as const, waiting: "Working on it" },
      { question: { id: "note:2", role: "user" as const, text: "and the header", timestamp: old, receipt: "sent" as const }, handoff: "queued" as const, waiting: "Working on it" },
    ];
    const source = new ClaudeCodeTranscriptSource({ projectDir: dir, inbox, crew: { steps: () => new Map([["note:1", "Running the footer tests"]]) } });
    expect(source.exchanges().map((exchange) => [exchange.question.id, exchange.question.receipt, exchange.waiting])).toEqual([
      ["note:1", "read", "Running the footer tests"],
      ["note:2", "sent", "Working on it"],
    ]);
  });

  it("says over the composer only the stuck coding work George has been told about", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const concern = { kind: "unreachable" as const, since: new Date().toISOString() };
    server!.staffView = () => ({
      snapshot: { at: new Date().toISOString(), available: true, readiness: { lock: "held", liveHarness: true, heartbeat: "healthy", canReceive: true }, workers: [], waitingOnHim: [], queued: 0, handoffs: [] },
      concerns: [
        { ...concern, key: "a", text: "Nobody has been looking after your coding work for 3 h.", toldAt: new Date().toISOString() },
        { ...concern, key: "b", text: "Still being asked about.", nudgedAt: new Date().toISOString() },
      ],
    });
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/stream?token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: staff")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    expect(JSON.parse(body.split("event: staff\ndata: ")[1]!.split("\n")[0]!)).toEqual({ text: "Nobody has been looking after your coding work for 3 h." });
  });

  it("follows the session that holds firstmate's lock, not the one written last", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-live-session-"));
    writeFileSync(join(dir, "live.jsonl"), [captain("fix it"), assistantText("On it.")].join("\n") + "\n");
    writeFileSync(join(dir, "other.jsonl"), [captain("unrelated"), assistantText("Sure.")].join("\n") + "\n");
    utimesSync(join(dir, "live.jsonl"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    let live: string | undefined = "live";
    const source = new ClaudeCodeTranscriptSource({ projectDir: dir, liveSession: async () => live });
    expect((await source.listSessions()).map((session) => session.id)).toEqual(["live", "other"]);
    live = undefined;
    expect((await source.listSessions()).map((session) => session.id)).toEqual(["other", "live"]);

    // The island's stream ends when another session takes the lock, so it reconnects to that one.
    live = "live";
    server = new ConversationViewServer(source);
    const port = await server.listen(0);
    const ended = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/status", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: status")) live = "other";
        });
        res.on("end", () => resolve(text));
      });
      req.on("error", reject);
      req.end();
    });
    expect(JSON.parse(ended.split("event: status\ndata: ")[1]!.split("\n")[0]!).session).toBe("live");
  }, 15_000);

  it("ends the live window stream when another session takes the lock, but never one opened on a chosen session", async () => {
    let sessions = [{ id: "live", title: "Live", updatedAt: new Date().toISOString() }];
    const source = {
      assistantLabel: "firstmate",
      canSend: false,
      listSessions: async () => sessions,
      read: async () => ({ messages: [], working: false }),
      follow: (_id: string, onUpdate: (s: { messages: never[]; working: boolean }) => void) => {
        onUpdate({ messages: [], working: false });
        return { close() {} };
      },
      commands: async () => [],
      image: async () => null,
    };
    server = new ConversationViewServer(source as never);
    const port = await server.listen(0);
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    const handoff = () => { sessions = [{ id: "other", title: "Other", updatedAt: new Date().toISOString() }]; };
    const watch = (path: string, withinMs: number) => new Promise<{ ended: boolean; text: string }>((resolve) => {
      let settled = false;
      let text = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ended: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ended, text }); };
      const req = request({ host: "127.0.0.1", port, path: `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(viewToken!)}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { text += chunk; if (text.includes("event: update")) handoff(); });
        res.on("end", () => finish(true));
      });
      req.on("error", () => finish(false));
      timer = setTimeout(() => { req.destroy(); finish(false); }, withinMs);
      req.end();
    });

    // No session chosen: the handoff ends the stream, so the page reconnects to the new live one.
    const live = await watch("/api/stream", 12_000);
    expect(live.ended).toBe(true);
    expect(live.text).toContain("event: session");

    // A session he chose by hand: it stays, whatever holds the lock.
    sessions = [{ id: "live", title: "Live", updatedAt: new Date().toISOString() }];
    const chosen = await watch("/api/stream?session=live", 7_000);
    expect(chosen.ended).toBe(false);
    expect(chosen.text).toContain("event: session");
  }, 25_000);

  it("feeds the island a compact status of the newest session", async () => {
    const port = await start(undefined, [captain("push it"), assistantText("» Pushed to main. Want me to merge the PR?")]);
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/status", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: status")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const status = JSON.parse(body.split("event: status\ndata: ")[1]!.split("\n")[0]!);
    expect(status).toMatchObject({ session: "s1", working: false, reply: { headline: "Want me to merge the change?", asks: true } });
  });

  it("shows what Flyd knows about the captain's taste, and lets only its own page reword or veto a rule", async () => {
    writeTaste({
      rules: [{ id: "abc12345", text: "No shadows on icon boxes.", scope: "personal", count: 2, projects: [], last: "2026-10-06",
        evidence: [{ quote: "no shadows on the icon boxes", source: "Claude Code", date: "2026-10-06" }] }],
      vetoed: [],
      retired: [{ id: "retired01", text: "Never hard-code an API key.", scope: "personal", count: 1, projects: [],
        evidence: [{ quote: "put the key on the server", source: "Claude Code", date: "2026-10-06" }] }],
      names: {},
    });
    const port = await start();
    const denied = await get(port, "/taste");
    expect(denied.status).toBe(403);
    expect(denied.body).not.toContain("No shadows on icon boxes.");
    const page = await get(port, `/taste?token=${encodeURIComponent(viewToken!)}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("No shadows on icon boxes.");
    expect(page.body).toContain("no shadows on the icon boxes");
    expect(page.body).toContain("Set aside as too generic");
    expect(page.body).toContain("Never hard-code an API key.");
    expect(page.body).toContain("put the key on the server");
    const token = /data-token="([0-9a-f]+)"/.exec(page.body)![1]!;
    const json = { "content-type": "application/json" };
    const veto = JSON.stringify({ action: "veto", id: "abc12345" });
    expect((await post(port, veto, json, "/api/taste")).status).toBe(403);
    expect((await post(port, veto, { ...json, "x-flyd-view-token": token, origin: "https://attacker.example" }, "/api/taste")).status).toBe(403);
    expect((await post(port, JSON.stringify({ action: "reword", id: "abc12345", text: "Never shadows on icon boxes." }), { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste().rules[0]!.text).toBe("Never shadows on icon boxes.");
    expect((await post(port, veto, { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste()).toMatchObject({ rules: [], vetoed: [{ id: "abc12345" }] });
    expect((await post(port, veto, { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(404);
    expect((await post(port, JSON.stringify({ action: "reword", id: "retired01", text: "Keep keys on the server." }), { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste().retired?.[0]!.text).toBe("Keep keys on the server.");
    expect((await post(port, JSON.stringify({ action: "restore", id: "retired01" }), { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste().rules.map((rule) => rule.id)).toContain("retired01");
  });

  it("lists no slash commands for a read-only conversation", async () => {
    const port = await start();
    expect(JSON.parse((await get(port, "/api/commands")).body)).toEqual({ commands: [] });
  });

  it("rejects requests carrying a foreign Host header", async () => {
    const port = await start();
    expect((await get(port, "/api/sessions", "attacker.example")).status).toBe(403);
  });

  it("delivers the captain's message only from its own page", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const token = tokenOf((await get(port, "/")).body);
    expect(token).toHaveLength(48);
    const json = { "content-type": "application/json" };
    const body = JSON.stringify({ session: "s1", text: "run the flyd viewer" });

    expect((await post(port, body, json)).status).toBe(403);
    expect((await post(port, body, { ...json, "x-flyd-view-token": "0".repeat(48) })).status).toBe(403);
    expect((await post(port, body, { ...json, "x-flyd-view-token": token, origin: "https://attacker.example" })).status).toBe(403);
    expect((await post(port, body, { "content-type": "text/plain", "x-flyd-view-token": token })).status).toBe(415);
    expect((await post(port, JSON.stringify({ session: "s1", text: "  " }), { ...json, "x-flyd-view-token": token })).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "../x", text: "hi" }), { ...json, "x-flyd-view-token": token })).status).toBe(502);
    expect(inbox.sent).toEqual([]);

    const ok = await post(port, body, { ...json, "x-flyd-view-token": token, origin: `http://127.0.0.1:${port}` });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ id: "note:1" });
    expect(inbox.sent.map((m) => m.text)).toEqual(["run the flyd viewer"]);

    const stream = await get(port, "/api/stream");
    const update = JSON.parse(stream.body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.order).toEqual([expect.any(String), expect.any(String), "note:1"]);
  });

  it("hands its current token to its own origin so an open tab can recover after a restart", async () => {
    const port = await start(new MemoryInbox());
    const token = tokenOf((await get(port, "/")).body);
    expect(JSON.parse((await get(port, "/api/token")).body)).toEqual({ token });
    expect((await get(port, "/api/token", "attacker.example")).status).toBe(403);
  });

  it("keeps the message box's draft and attachments through a restart of the view, behind its token", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-drafts-"));
    const inbox = new MemoryInbox();
    let port = await start(inbox, undefined, undefined, new ComposerDrafts({ root }));
    let token = tokenOf((await get(port, "/")).body);
    const json = { "content-type": "application/json" };
    const draftOf = (p: number, t: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: p, path: "/api/draft?key=latest", headers: { host: `127.0.0.1:${p}`, "x-flyd-view-token": t } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end();
    });

    const picture = JSON.stringify({ mediaType: "image/png", data: PNG });
    expect((await post(port, picture, json, "/api/draft/attachment")).status).toBe(403);
    expect((await post(port, picture, { ...json, "x-flyd-view-token": token, origin: "https://attacker.example" }, "/api/draft/attachment")).status).toBe(403);
    expect((await post(port, JSON.stringify({ mediaType: "text/html", data: PNG }), { ...json, "x-flyd-view-token": token }, "/api/draft/attachment")).status).toBe(400);
    const image = JSON.parse((await post(port, picture, { ...json, "x-flyd-view-token": token }, "/api/draft/attachment")).body) as { id: string };
    const doc = JSON.parse((await post(port, JSON.stringify({ name: "Q3 report.pdf", data: btoa("%PDF-1.3 hello") }), { ...json, "x-flyd-view-token": token }, "/api/draft/attachment")).body) as { id: string };
    const draft = { text: "half a thought about the hero", selectionStart: 6, selectionEnd: 12, savedAt: 1, attachments: [{ id: image.id, mediaType: "image/png" }, { id: doc.id, name: "Q3 report.pdf" }] };
    expect((await post(port, JSON.stringify({ key: "latest", draft }), { ...json, "x-flyd-view-token": token }, "/api/draft")).status).toBe(200);
    expect((await draftOf(port, "0".repeat(48))).status).toBe(403);

    // A new view process: new token, same draft.
    await server!.close();
    port = await start(inbox, undefined, undefined, new ComposerDrafts({ root }));
    token = tokenOf((await get(port, "/")).body);
    expect(JSON.parse((await draftOf(port, token)).body).draft).toEqual({
      ...draft,
      attachments: [{ id: image.id, mediaType: "image/png", data: PNG }, { id: doc.id, name: "Q3 report.pdf", data: btoa("%PDF-1.3 hello") }],
    });

    // Sent: the box is empty and the draft goes.
    expect((await post(port, JSON.stringify({ key: "latest", draft: { text: "", selectionStart: 0, selectionEnd: 0, attachments: [] } }), { ...json, "x-flyd-view-token": token }, "/api/draft")).status).toBe(200);
    expect(JSON.parse((await draftOf(port, token)).body)).toEqual({ draft: null });
    expect(inbox.sent).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("offers no message box and refuses sends when the source is read-only", async () => {
    const port = await start();
    const page = (await get(port, "/")).body;
    expect(tokenOf(page)).toBe("");
    expect((await get(port, "/api/token")).status).toBe(200);
    expect((await post(port, JSON.stringify({ session: "s1", text: "hi" }), { "content-type": "application/json" })).status).toBe(405);
  });

  it("serves a pasted transcript image as an image, and nothing for unknown ids", async () => {
    const port = await start(undefined, [captainBlocks([{ type: "text", text: "[Image #1] broken" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }])]);
    const stream = await get(port, "/api/stream");
    const update = JSON.parse(stream.body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.messages[0].html).toBe("<p>broken</p>\n");
    const [id] = update.messages[0].images;

    const image = await get(port, `/api/image?session=s1&id=${encodeURIComponent(id)}`);
    expect(image.status).toBe(200);
    expect(image.type).toBe("image/png");
    expect((await get(port, "/api/image?session=s1&id=t1.9")).status).toBe(404);
    expect((await get(port, `/api/image?session=..%2Fx&id=${encodeURIComponent(id)}`)).status).toBe(404);
  });

  it("serves a fleet task's screenshot only with the token and only when the artefact listed it", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    writeFileSync(join(dir, "s1.jsonl"), [captain("hello")].join("\n") + "\n");
    const shot = join(dir, "after.png");
    writeFileSync(shot, Buffer.from(PNG, "base64"));
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {}, shotPath: (task: string, file: string) => (task === "a" && file === "after.png" ? shot : null) };
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, assistantLabel: "firstmate" }), undefined, undefined, undefined, feed as unknown as ArtefactFeed);
    const port = await server.listen(0);
    const token = JSON.parse((await get(port, "/api/token")).body).token;
    expect((await get(port, "/api/artefact-shot?task=a&file=after.png")).status).toBe(403);
    const image = await get(port, `/api/artefact-shot?task=a&file=after.png&token=${token}`);
    expect(image.status).toBe(200);
    expect(image.type).toBe("image/png");
    expect((await get(port, `/api/artefact-shot?task=a&file=..%2Fs1.jsonl&token=${token}`)).status).toBe(404);
  });

  it("passes pasted images through to the inbox, and accepts an image with no text", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const token = tokenOf((await get(port, "/")).body);
    const headers = { "content-type": "application/json", "x-flyd-view-token": token };
    const images = [{ mediaType: "image/png", data: PNG }];
    expect((await post(port, JSON.stringify({ session: "s1", text: "", images }), headers)).status).toBe(200);
    expect(inbox.uploads).toEqual(images);
    expect((await post(port, JSON.stringify({ session: "s1", text: "", images: [{ mediaType: 1 }] }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", text: "  ", images: [] }), headers)).status).toBe(400);
  });

  it("passes dropped documents through to the inbox, and accepts a document with no text", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const token = tokenOf((await get(port, "/")).body);
    const headers = { "content-type": "application/json", "x-flyd-view-token": token };
    const files = [{ name: "brief.pdf", data: Buffer.from("%PDF-1.3").toString("base64") }];
    expect((await post(port, JSON.stringify({ session: "s1", text: "", files }), headers)).status).toBe(200);
    expect(inbox.documents).toEqual(files);
    expect((await post(port, JSON.stringify({ session: "s1", text: "", files: [{ name: 1, data: "" }] }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", text: " ", files: [] }), headers)).status).toBe(400);
  });
});
