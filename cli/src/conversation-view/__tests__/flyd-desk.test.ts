import { execFileSync } from "node:child_process";
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
import { headlineOf, statusOf } from "../status.js";
import { digestReply, ReplySummarizer } from "../summaries.js";
import type { ConversationSnapshot } from "../types.js";
import { assistantText, captain, injection, toolUse } from "./transcript-fixture.js";

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

  it("keeps slash commands, screenshots, documents and anything unsure with firstmate", async () => {
    expect(await routeMessage({ ...input, command: "review" }, ask("FLYD"))).toBe("firstmate");
    expect(await routeMessage({ ...input, images: 1 }, ask("FLYD"))).toBe("firstmate");
    expect(await routeMessage({ ...input, files: 1 }, ask("FLYD"))).toBe("firstmate");
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
  // Records `note -` and `reply` calls without waking anyone, writing the same
  // files firstmate's own bin/fm-inbox.sh writes.
  const FAKE_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  note)
    [ "\${2:-}" = "-" ] || { echo "usage" >&2; exit 2; }
    body=$(cat)
    mkdir -p "$FM_HOME/state/inbox"
    id="$(date +%s)-$RANDOM"
    printf 'id=%s\\nat=%s\\nsource=text\\n--\\n%s\\n' "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$body" > "$FM_HOME/state/inbox/$id.note"
    printf 'queued %s\\n' "$id"
    ;;
  reply)
    id="\${2:?reply needs a note id}"
    body="\${3:-}"
    mkdir -p "$FM_HOME/state/inbox/.replies"
    printf 'id=%s\\nat=%s\\nseq=1\\n--\\n%s\\n' "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$body" > "$FM_HOME/state/inbox/.replies/$id"
    printf 'replied %s\\n' "$id"
    ;;
  *)
    echo "usage" >&2; exit 2 ;;
esac
`;

  function setup(route: string) {
    const project = join(dir, "project");
    const home = join(dir, "firstmate");
    mkdirSync(project);
    mkdirSync(home);
    // Firstmate's line carries its context use, which is firstmate's machinery, not Flyd's.
    const line = JSON.parse(assistantText("Captain, the island filter is still paused on your call.")) as { message: Record<string, unknown> };
    line.message.usage = { input_tokens: 1_000, cache_read_input_tokens: 258_000 };
    writeFileSync(join(project, "s1.jsonl"), [captain("status?"), JSON.stringify(line)].join("\n") + "\n");
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

  it("never lets firstmate's 'Captain' reach him: lines, narration, summaries, interpretations and the island", async () => {
    const project = join(dir, "project");
    const home = join(dir, "firstmate");
    mkdirSync(project);
    mkdirSync(join(home, "state", "inbox", "handled"), { recursive: true });
    mkdirSync(join(home, "state", "inbox", ".replies"), { recursive: true });
    const report = "Captain, the cards are recoloured and the island filter is back on. ".repeat(4) + "\n\nThe captain must pick a colour for the dark theme before the captain's release goes out.";
    writeFileSync(join(project, "s1.jsonl"), [
      captain("status?"),
      assistantText(report),
      captain("ok?"),
      assistantText("Captain, shipshape."),
      captain("and the island?"),
      assistantText("Captain, the captain's island is still paused on your call, Captain."),
      captain("fix the cards"),
      toolUse("TodoWrite", { todos: [{ content: "x", activeForm: "Checking the captain's cards", status: "in_progress" }] }),
    ].join("\n") + "\n");
    writeFileSync(join(home, "state", "inbox", "handled", "1-a.note"), "id=1-a\nat=2030-01-01T00:00:00Z\n--\nis the island hiding things?\n");
    writeFileSync(join(home, "state", "inbox", ".replies", "1-a"), "id=1-a\nat=2030-01-01T00:01:00Z\n--\nCaptain, yes.\n\nThe captain decides: keep the filter or drop it.\n");
    const source = new ClaudeCodeTranscriptSource({
      projectDir: project,
      inbox: new FirstmateInbox({ home, script: join(dir, "fm-inbox.sh") }),
      desk: { desk: new FlydDesk({ dir: join(dir, "asks"), answer: async () => "" }), complete: async () => "FIRSTMATE" },
    });
    const snapshot = await source.read("s1");
    expect(snapshot.activity).toBeTruthy();

    const summarizer = new ReplySummarizer({
      cacheFile: join(dir, "summaries.json"),
      providers: [{ name: "fake", summarize: async (text) => { if (text.includes("dark theme")) return "The captain must pick a colour, Captain."; throw new Error("down"); } }],
    });
    const interpreter = new AnswerInterpreter({ cacheFile: join(dir, "interpretations.json"), profile: () => null, complete: () => new Promise<string>(() => {}) });
    let landed!: () => void;
    const arrived = new Promise<void>((resolve) => { landed = resolve; });
    const differ = new SnapshotDiffer({ summarizer, interpreter, onSummary: () => landed() });
    const first = differ.next(snapshot);
    await arrived;
    const update = differ.next(snapshot);
    expect(update.messages.some((message) => message.summary?.source === "model")).toBe(true);
    expect(first.messages.find((message) => message.answers === "note:1-a")?.summary?.pending).toBe(true);

    const shown = JSON.stringify([first, update]);
    expect(shown).not.toMatch(/captain/i);
    expect(JSON.stringify(statusOf(snapshot, Date.parse(snapshot.lastActivity ?? "") || Date.now()))).not.toMatch(/captain/i);
  });

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
    expect(messages.find((message) => message.id === sent.id)).toMatchObject({ waiting: "Flyd has it queued" });
    const relay = messages.find((message) => message.role === "assistant")!;
    expect(relay).toMatchObject({ aside: true, text: "Sir, the island filter is still paused on your call." });
    expect(messages.map((message) => message.text).join("\n")).not.toMatch(/captain/i);
  });

  it("shows each note followed by firstmate's own reply, written by fm-inbox.sh reply", async () => {
    const { source, home } = setup("FIRSTMATE");
    const answered = await source.send("s1", "push the island redesign");
    const pending = await source.send("s1", "and the settings screen?");
    // Firstmate answers the first note with its own `bin/fm-inbox.sh reply <id> "<text>"`.
    execFileSync(join(dir, "fm-inbox.sh"), ["reply", answered.id.replace(/^note:/, ""), "Captain, pushed. Want me to merge?"], {
      env: { ...process.env, FM_HOME: home },
    });

    const messages = (await source.read("s1")).messages;
    const question = messages.find((message) => message.id === answered.id)!;
    // The reply sits directly under its own note, in Flyd's voice.
    expect(messages[messages.indexOf(question) + 1]).toMatchObject({ role: "assistant", answers: answered.id, text: "Sir, pushed. Want me to merge?" });
    // A note with no reply still renders, cleanly, saying what is happening to it.
    const waiting = messages.find((message) => message.id === pending.id)!;
    expect(waiting.waiting).toBeTruthy();
    expect(messages.some((message) => message.answers === pending.id)).toBe(false);
  });

  it("shows a note sent now in the live session, even when a later session started while it ran", async () => {
    const project = join(dir, "overlap");
    const home = join(dir, "overlap-home");
    mkdirSync(project);
    mkdirSync(join(home, "state", "inbox", "handled"), { recursive: true });
    mkdirSync(join(home, "state", "inbox", ".replies"), { recursive: true });
    // The live conversation started first and is still being written; a mirror
    // session started later and has been idle since. George sends a note now.
    writeFileSync(join(project, "live.jsonl"), [captain("status?"), assistantText("Sir, working.")].join("\n") + "\n");
    writeFileSync(join(project, "mirror.jsonl"), [captain("mirror?"), assistantText("Sir, mirrored.")].join("\n") + "\n");
    utimesSync(join(project, "live.jsonl"), new Date("2026-10-05T18:05:00Z"), new Date("2026-10-05T18:05:00Z"));
    utimesSync(join(project, "mirror.jsonl"), new Date("2026-10-05T17:30:00Z"), new Date("2026-10-05T17:30:00Z"));
    const NOTE = "1791516064-ZGKFlI";
    writeFileSync(join(home, "state", "inbox", "handled", `${NOTE}.note`), `id=${NOTE}\nat=2026-10-05T18:00:00Z\n--\nwhat's on tonight?\n`);
    writeFileSync(join(home, "state", "inbox", ".replies", NOTE), `id=${NOTE}\nat=2026-10-05T18:02:00Z\nseq=1\n--\nCaptain, art bangkok tonight.\n`);

    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox: new FirstmateInbox({ home }) });
    const messages = (await source.read("live")).messages;
    const question = messages.find((message) => message.id === `note:${NOTE}`);
    expect(question).toBeTruthy();
    expect(messages[messages.indexOf(question!) + 1]).toMatchObject({ answers: `note:${NOTE}`, text: "Sir, art bangkok tonight." });
  });

  it("is Flyd's window: named Flyd, no firstmate context meter, no firstmate in a refusal", async () => {
    const { source } = setup("FIRSTMATE");
    expect(source.assistantLabel).toBe("Flyd");
    const snapshot = await source.read("s1");
    expect(snapshot.context).toBeUndefined();
    expect(snapshot.messages.map((message) => message.waiting ?? "").join(" ")).not.toMatch(/firstmate/i);

    writeFileSync(join(dir, "fm-inbox.sh"), "#!/bin/sh\necho 'fm-inbox: firstmate was NOT woken' >&2\nexit 1\n");
    await expect(source.send("s1", "fix the island filter")).rejects.toThrow(/^Flyd couldn't pass this on just now; send it again$/);
  });

  it("keeps the plain firstmate view as it was without a desk", () => {
    expect(new ClaudeCodeTranscriptSource({ projectDir: join(dir, "-Users-x-Documents-firstmate") }).assistantLabel).toBe("firstmate");
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

  it("asks the model two at a time and keeps only the newest 20 on disk", async () => {
    let running = 0;
    let most = 0;
    const cacheFile = join(dir, "interpretations.json");
    const interpreter = new AnswerInterpreter({
      cacheFile,
      profile: () => null,
      complete: async (prompt) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
        return `Sir, outcome ${/answer (\d+)/.exec(prompt)![1]} landed and needs your call.`;
      },
    });
    const answers = Array.from({ length: 25 }, (_, index) => `The answer ${index} is in.`);
    const results = await Promise.all(answers.map((answer) => interpreter.request({ question: "q", answer, recent: [] })));
    expect(results.every(Boolean)).toBe(true);
    expect(most).toBe(2);
    expect(Object.keys(JSON.parse(readFileSync(cacheFile, "utf8")) as object)).toHaveLength(20);
    const reloaded = new AnswerInterpreter({ cacheFile, complete: async () => "" });
    expect(reloaded.cached(answers[24]!)).toContain("outcome 24");
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

describe("supervision chatter never reaches Flyd's window", () => {
  // Firstmate's own words from its supervision session, exactly as the captain saw them relayed as an update.
  const STALE_WAKE = "The stale wake for the Flyd going-silent worker needed no action. The worker is idle because it's finished, and PR 84 (https://github.com/GeorgeGally/flyd/pull/84) is still waiting on the captain's merge. The PR hasn't landed, so I didn't tear anything down.\n\nI reported it as a silent routine outcome, since I already reported this same situation to MAIN as a captain-level item. The wake is acknowledged.";
  const WAKE = "<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\nStop hook blocking error from command \"Stop\": firstmate watcher wake - one supervision event needs a handling turn now.\n</system-reminder>";
  const sdk = { origin: undefined, entrypoint: "sdk-cli", promptSource: "sdk", userType: "external" };

  function source(project: string, home: string) {
    return new ClaudeCodeTranscriptSource({
      projectDir: project,
      inbox: new FirstmateInbox({ home, script: join(dir, "fm-inbox.sh") }),
      desk: { desk: new FlydDesk({ dir: join(dir, "asks"), answer: async () => "" }), complete: async () => "FIRSTMATE" },
    });
  }

  it("leaves firstmate's SDK supervision session out of the window, the island and a note's placement", async () => {
    const project = join(dir, "project");
    const home = join(dir, "firstmate");
    mkdirSync(project);
    mkdirSync(join(home, "state", "inbox", "handled"), { recursive: true });
    writeFileSync(join(project, "main.jsonl"), [
      captain("is the going-silent fix ready?", { entrypoint: "cli" }),
      assistantText("Captain, the going-silent fix is ready: https://github.com/GeorgeGally/flyd/pull/84", "end_turn", { entrypoint: "cli" }),
    ].join("\n") + "\n");
    writeFileSync(join(project, "supervision.jsonl"), [
      JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-10-05T18:00:00.000Z", content: "MAIN DIALOG MIRROR" }),
      captain("MAIN DIALOG MIRROR (read-only context)\n\nstale: firstmate:flyd-going-silent", sdk),
      assistantText(STALE_WAKE, "end_turn", { entrypoint: "sdk-cli" }),
    ].join("\n") + "\n");
    // The supervision session is the newest transcript, as it was when he saw the update.
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(project, "main.jsonl"), past, past);
    // He asked after the supervision session started: the note still belongs to his conversation.
    writeFileSync(join(home, "state", "inbox", "handled", "1791600000-abc.note"), "id=1791600000-abc\nat=2026-10-05T19:00:00Z\n--\nwhat's the fleet doing?\n");

    const view = source(project, home);
    expect((await view.listSessions()).map((session) => session.id)).toEqual(["main"]);
    const snapshot = await view.read("main");
    expect(snapshot.messages.map((message) => message.text).join("\n")).not.toMatch(/stale wake|routine outcome|MAIN/);
    expect(snapshot.messages.at(-1)).toMatchObject({ id: "note:1791600000-abc", waiting: "Flyd is on it" });
    expect(statusOf(snapshot).reply?.headline).not.toMatch(/stale wake/i);
  });

  it("relays firstmate's answers to its own wakes only when they name a PR, ask his decision or report a failure", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "main.jsonl"), [
      captain("how's the island?"),
      assistantText("Captain, the island filter is back on and working."),
      injection(WAKE),
      assistantText("The stale wake for the Good Neighbours site worker was a false alarm. The worker isn't wedged.\n\nI took no action and reported it to MAIN as a silent routine outcome. The wake is acknowledged."),
      injection(WAKE),
      assistantText("Captain, the settings screen is ready to merge: https://github.com/GeorgeGally/flyd/pull/90"),
      injection(WAKE),
      assistantText("Captain, the Good Neighbours worker failed its build twice and stopped."),
      injection(WAKE),
      assistantText("Captain, the lab page has two layouts. Should I keep the grid or the list?"),
    ].join("\n") + "\n");

    const snapshot = await source(project, join(dir, "firstmate")).read("main");
    const relays = snapshot.messages.filter((message) => message.role === "assistant");
    expect(relays.map((message) => message.text)).toEqual([
      "Sir, the island filter is back on and working.",
      "Sir, the settings screen is ready to merge: https://github.com/GeorgeGally/flyd/pull/90",
      "Sir, the Good Neighbours worker failed its build twice and stopped.",
      "Sir, the lab page has two layouts. Should I keep the grid or the list?",
    ]);
    // The island reads the same snapshot, so it names only what the window shows.
    expect(relays.map((message) => message.id)).toContain(statusOf(snapshot).reply?.id);
  });
});
