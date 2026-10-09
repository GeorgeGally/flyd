import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox, mergeNotes, relayed } from "../firstmate-inbox.js";
import { FlydDesk, routeMessage, routePrompt, type Answerer } from "../flyd-desk.js";
import { inFlydsVoice } from "../flyd-voice.js";
import { AnswerInterpreter } from "../interpret.js";
import { SnapshotDiffer } from "../server.js";
import { headlineOf } from "../status.js";
import { digestReply } from "../summaries.js";
import type { ConversationSnapshot } from "../types.js";
import { assistantText, captain } from "./transcript-fixture.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-view-desk-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function until<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("inFlydsVoice", () => {
  it("turns firstmate's address to Flyd into Flyd's address to him", () => {
    expect(inFlydsVoice("Captain, the island filter is still paused on your call.")).toBe("Sir, the island filter is still paused on your call.");
    expect(inFlydsVoice("Done, Captain. PR is green.")).toBe("Done, sir. PR is green.");
    expect(inFlydsVoice("It's the captain's call. I'll tell the captain.")).toBe("It's your call. I'll tell you.");
    expect(inFlydsVoice("- Captain, two things:\n- captain please pick")).toBe("- Sir, two things:\n- Sir please pick");
  });

  it("never leaves 'Captain' in the words, but leaves code alone", () => {
    const text = "Captain: merged. CAPTAIN! See `captain.ts` and\n```\nconst captain = 1;\n```";
    const voiced = inFlydsVoice(text);
    expect(voiced.replace(/`[^`]*`|```[\s\S]*?```/g, "")).not.toMatch(/captain/i);
    expect(voiced).toContain("`captain.ts`");
    expect(voiced).toContain("const captain = 1;");
  });
});

describe("routeMessage", () => {
  const ask = (answer: string | Error) => async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const input = { text: "whats there to do in bkk tonight? i see there is an art festival?", images: 0, recent: [] };

  it("sends a general question to Flyd and software work to firstmate, as the model says", async () => {
    expect(await routeMessage(input, ask("FLYD"))).toBe("flyd");
    expect(await routeMessage({ ...input, text: "fix the island filter" }, ask("FIRSTMATE"))).toBe("firstmate");
  });

  it("keeps slash commands, screenshots and anything unsure with firstmate", async () => {
    expect(await routeMessage({ ...input, command: "review" }, ask("FLYD"))).toBe("firstmate");
    expect(await routeMessage({ ...input, images: 1 }, ask("FLYD"))).toBe("firstmate");
    expect(await routeMessage(input, ask(new Error("no key")))).toBe("firstmate");
    expect(await routeMessage(input, ask("maybe"))).toBe("firstmate");
    expect(await routeMessage(input, () => new Promise<string>(() => {}), 20)).toBe("firstmate");
  });

  it("shows the model what firstmate last asked, so a bare answer like 'A' goes back to it", () => {
    const prompt = routePrompt("A", [
      { id: "t1", role: "assistant", aside: true, text: "Sir, should I go with A or B for the island filter?" },
    ]);
    expect(prompt).toContain("Firstmate (update): Sir, should I go with A or B for the island filter?");
    expect(prompt).toContain("New message from George: A");
  });
});

describe("FlydDesk", () => {
  function deferred(): { answer: Answerer; resolve: (text: string) => void; reject: (error: Error) => void; history: unknown[] } {
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const history: unknown[] = [];
    const answer: Answerer = (_question, earlier) => {
      history.push(earlier);
      return new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    };
    return { answer, resolve: (text) => resolve(text), reject: (error) => reject(error), history };
  }

  it("shows Flyd thinking, then its own answer under the question", async () => {
    const turn = deferred();
    const desk = new FlydDesk({ dir, answer: turn.answer });
    const sent = desk.ask("  whats there to do in bkk tonight?  ");
    expect(desk.exchanges()).toEqual([{ question: { id: sent.id, role: "user", text: "whats there to do in bkk tonight?", timestamp: sent.timestamp }, waiting: "Flyd is thinking…" }]);

    turn.resolve("Tonight, sir: art bangkok at Siam Paragon.");
    const [exchange] = await until(() => (desk.exchanges()[0]?.answer ? desk.exchanges() : undefined));
    expect(exchange!.answer).toMatchObject({ role: "assistant", answers: sent.id, text: "Tonight, sir: art bangkok at Siam Paragon." });

    // The next question carries the earlier exchange as history.
    desk.ask("and tomorrow?");
    expect(turn.history.at(-1)).toEqual([
      { role: "user", content: "whats there to do in bkk tonight?" },
      { role: "assistant", content: "Tonight, sir: art bangkok at Siam Paragon." },
    ]);
  });

  it("says when Flyd could not answer, and when a restart cut it off", async () => {
    const turn = deferred();
    const desk = new FlydDesk({ dir, answer: turn.answer });
    desk.ask("what's the weather");
    turn.reject(new Error("model unavailable"));
    await until(() => (desk.exchanges()[0]?.waiting.startsWith("Flyd couldn't") ? true : undefined));
    expect(desk.exchanges()[0]!.waiting).toBe("Flyd couldn't answer this: model unavailable");

    desk.ask("still there?");
    const restarted = new FlydDesk({ dir, answer: turn.answer });
    expect(restarted.exchanges()[1]!.waiting).toBe("Flyd was interrupted before answering; send it again");
  });
  it("reads a stored question again only when its file changes", async () => {
    const desk = new FlydDesk({ dir, answer: async () => "Siam Paragon, sir." });
    const sent = desk.ask("bkk tonight?");
    await until(() => (desk.exchanges()[0]?.answer ? true : undefined));
    const file = join(dir, `${sent.id.slice("ask:".length)}.json`);
    const stored = readFileSync(file, "utf8");
    const at = new Date("2026-10-09T03:00:00Z");
    utimesSync(file, at, at);
    expect(desk.exchanges()[0]!.answer!.text).toBe("Siam Paragon, sir.");

    // Same size and mtime: the parsed record is reused, not read again.
    writeFileSync(file, stored.replace("Siam Paragon", "Siam Pxragon"));
    utimesSync(file, at, at);
    expect(desk.exchanges()[0]!.answer!.text).toBe("Siam Paragon, sir.");

    writeFileSync(file, stored.replace("Siam Paragon", "Lumphini Park"));
    expect(desk.exchanges()[0]!.answer!.text).toBe("Lumphini Park, sir.");

    rmSync(file);
    expect(desk.exchanges()).toEqual([]);
  });
});

describe("ClaudeCodeTranscriptSource as Flyd's window", () => {
  // Records `note -` calls without waking anyone.
  const FAKE_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
body=$(cat)
mkdir -p "$FM_HOME/state/inbox"
id="$(date +%s)-$RANDOM"
printf 'id=%s\\nat=%s\\nsource=text\\n--\\n%s\\n' "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$body" > "$FM_HOME/state/inbox/$id.note"
printf 'queued %s\\n' "$id"
`;

  function setup(route: string) {
    const project = join(dir, "project");
    const home = join(dir, "firstmate");
    mkdirSync(project);
    mkdirSync(home);
    writeFileSync(join(project, "s1.jsonl"), [captain("status?"), assistantText("Captain, the island filter is still paused on your call.")].join("\n") + "\n");
    const script = join(dir, "fm-inbox.sh");
    writeFileSync(script, FAKE_SCRIPT);
    chmodSync(script, 0o755);
    const answered: string[] = [];
    const desk = new FlydDesk({ dir: join(dir, "asks"), answer: async (question) => { answered.push(question); return "Sir, art bangkok is on at Siam Paragon tonight."; } });
    const source = new ClaudeCodeTranscriptSource({
      projectDir: project,
      inbox: new FirstmateInbox({ home, script }),
      desk: { desk, complete: async () => route },
      pollMs: 15,
    });
    return { source, home, answered };
  }

  it("answers a general question itself and never sends it to firstmate", async () => {
    const { source, home, answered } = setup("FLYD");
    const updates: ConversationSnapshot[] = [];
    const follower = source.follow("s1", (snapshot) => updates.push(snapshot));
    try {
      const sent = await source.send("s1", "whats there to do in bkk tonight?");
      expect(sent.id).toMatch(/^ask:/);
      const messages = await until(() => {
        const latest = updates.at(-1)!.messages;
        return latest.some((message) => message.answers === sent.id) ? latest : undefined;
      });
      const index = messages.findIndex((message) => message.id === sent.id);
      expect(messages[index + 1]).toMatchObject({ role: "assistant", answers: sent.id, text: "Sir, art bangkok is on at Siam Paragon tonight." });
      expect(answered).toEqual(["whats there to do in bkk tonight?"]);
      expect(readdirSync(home)).not.toContain("state");
    } finally {
      follower.close();
    }
  });

  it("sends software work to firstmate, and relays firstmate's own lines as updates in Flyd's voice", async () => {
    const { source, home, answered } = setup("FIRSTMATE");
    const sent = await source.send("s1", "fix the island filter");
    expect(sent.id).toMatch(/^note:/);
    expect(answered).toEqual([]);
    expect(readdirSync(join(home, "state", "inbox")).filter((name) => name.endsWith(".note"))).toHaveLength(1);

    const messages = (await source.read("s1")).messages;
    expect(messages.find((message) => message.id === sent.id)).toMatchObject({ waiting: "passed to firstmate" });
    const relay = messages.find((message) => message.role === "assistant")!;
    expect(relay).toMatchObject({ aside: true, text: "Sir, the island filter is still paused on your call." });
    expect(messages.map((message) => message.text).join("\n")).not.toMatch(/captain/i);
  });
});

describe("a firstmate answer to his note, told by Flyd", () => {
  const answer = [
    "Captain, you're right. The Flyd chat box sends every message to me, the fleet supervisor, not to Flyd's own assistant, so I answered your Bangkok question instead of Flyd.",
    "That is why the university question failed too: Flyd's memory of you never saw it, and a safety check stopped me reading your personal Flyd records.",
    "The fix: Flyd answers personal and general questions itself, and shows my full answer to each note under the question.",
  ].join("\n\n");

  const NOTE = "1791516800-IZG4Ol";
  const decision = [
    "Captain, you're right.",
    "The island filter hid two real outcomes last night along with the supervision chatter.",
    "Decide whether to keep the filter: keeping it hides real outcomes; dropping it brings back every status ping.",
    "PR: https://github.com/GeorgeGally/flyd/pull/70",
  ].join("\n\n");

  function noteWithReply(reply: string) {
    const home = join(dir, "firstmate");
    mkdirSync(join(home, "state", "inbox", "handled"), { recursive: true });
    mkdirSync(join(home, "state", "inbox", ".replies"), { recursive: true });
    writeFileSync(join(home, "state", "inbox", "handled", `${NOTE}.note`), `id=${NOTE}\nat=2026-10-09T03:30:00Z\n--\nis the island hiding things from me?\n`);
    writeFileSync(join(home, "state", "inbox", ".replies", NOTE), `id=${NOTE}\nat=2026-10-09T03:33:41Z\nseq=5\n--\n${reply}\n`);
    return mergeNotes(relayed([]), new FirstmateInbox({ home }).notes(), {});
  }

  const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'");

  it("is told by Flyd: its model's reading leads, firstmate's words wait behind it", async () => {
    const prompts: string[] = [];
    const interpreter = new AnswerInterpreter({
      cacheFile: join(dir, "interpretations.json"),
      profile: () => "George studied at the University of Cape Town.",
      complete: async (prompt) => {
        prompts.push(prompt);
        return "Sir, the island hid two real outcomes last night.\n\n- **Your call:** keep the filter and real outcomes stay hidden, or drop it and every status ping comes back. Captain's choice.\n- PR: https://github.com/GeorgeGally/flyd/pull/70";
      },
    });
    let landed!: () => void;
    const arrived = new Promise<void>((resolve) => { landed = resolve; });
    const differ = new SnapshotDiffer({ interpreter, onSummary: () => landed() });
    const messages = noteWithReply(decision);

    const first = differ.next({ messages, working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;
    expect(first.summary).toMatchObject({ source: "digest", pending: true });
    await arrived;
    const shown = differ.next({ messages, working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;

    expect(shown.summary?.source).toBe("flyd");
    expect(shown.summary?.pending).toBeUndefined();
    expect(shown.routine).toBeUndefined();
    const lead = plain(shown.summary!.html);
    expect(lead).toContain("keep the filter and real outcomes stay hidden");
    expect(lead).toContain("every status ping comes back");
    expect(lead).not.toMatch(/captain/i);
    expect(plain(shown.html)).toContain("Decide whether to keep the filter");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("is the island hiding things from me?");
    expect(prompts[0]).toContain(inFlydsVoice(decision));
    expect(prompts[0]).toContain("George studied at the University of Cape Town.");

    const again = new AnswerInterpreter({ cacheFile: join(dir, "interpretations.json"), complete: async () => { throw new Error("asked twice"); } });
    expect(again.cached(messages.find((message) => message.answers)!.text)).toContain("Your call");
  });

  it("leads with the decision, not the acknowledgement, while there is no interpretation", () => {
    const shown = new SnapshotDiffer().next({ messages: noteWithReply(decision), working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;
    expect(shown.summary).toMatchObject({ source: "digest" });
    expect(shown.summary?.pending).toBeUndefined();
    const lead = plain(shown.summary!.html);
    expect(lead).toMatch(/^The island filter hid two real outcomes/);
    expect(lead).toContain("Decide whether to keep the filter: keeping it hides real outcomes; dropping it brings back every status ping.");
    expect(lead).not.toMatch(/captain/i);
  });

  it("falls back to the digest when the model only acknowledges or fails", async () => {
    const interpreter = new AnswerInterpreter({ cacheFile: join(dir, "interpretations.json"), profile: () => null, complete: async () => "You're right." });
    const answer = noteWithReply(decision).find((message) => message.answers)!.text;
    expect(await interpreter.request({ question: "q", answer, recent: [] })).toBeUndefined();
    const failing = new AnswerInterpreter({ cacheFile: join(dir, "other.json"), profile: () => null, complete: async () => { throw new Error("no model"); } });
    expect(await failing.request({ question: "q", answer, recent: [] })).toBeUndefined();
  });

  it("leaves Flyd's own answers whole", () => {
    const shown = new SnapshotDiffer().next({
      messages: [
        { id: "ask:1", role: "user", text: "where did i go to university?" },
        { id: "answer:1", role: "assistant", text: decision.replace(/Captain/g, "Sir"), answers: "ask:1" },
      ],
      working: false,
    }).messages.find((message) => message.id === "answer:1")!;
    expect(shown.summary).toBeUndefined();
    expect(plain(shown.html)).toContain("Sir, you're right.");
  });

  it("leads with the substance, not the acknowledgement, wherever it is cut short", () => {
    const voiced = inFlydsVoice(answer);
    expect(digestReply(voiced).lead).toMatch(/^The Flyd chat box sends every message to me/);
    expect(headlineOf(voiced)).toMatch(/^The Flyd chat box sends every message/);
  });
});
