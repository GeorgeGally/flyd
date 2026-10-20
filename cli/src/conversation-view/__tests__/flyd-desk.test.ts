import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox, mergeNotes, relayed } from "../firstmate-inbox.js";
import { FlydDesk, routeMessage, routePrompt, type Answerer } from "../flyd-desk.js";
import { answeringLine } from "../living.js";
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

  it("leaves links, paths and names that merely contain 'captain' as written", () => {
    const text = "Task gnm-lab is captain-held; see data/captain-shared.md, bin/fm-captain-hold.sh and https://github.com/x/captain-api/pull/3. Done, captain.";
    expect(inFlydsVoice(text)).toBe("Task gnm-lab is captain-held; see data/captain-shared.md, bin/fm-captain-hold.sh and https://github.com/x/captain-api/pull/3. Done, sir.");
    expect(inFlydsVoice("Captain, [the captain's call](https://example.com/captain/1) waits on the captain."))
      .toBe("Sir, [your call](https://example.com/captain/1) waits on you.");
    expect(inFlydsVoice("The captain-held task stays; captain_id and captain.ts too.")).toBe("The captain-held task stays; captain_id and captain.ts too.");
  });
});

describe("routeMessage", () => {
  const ask = (answer: string | Error) => async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const input = { text: "whats there to do in bkk tonight? i see there is an art festival?", recent: [] };

  it("sends a general question to Flyd and software work to firstmate, as the model says", async () => {
    expect(await routeMessage(input, ask("FLYD"))).toBe("flyd");
    expect(await routeMessage({ ...input, text: "fix the island filter" }, ask("FIRSTMATE"))).toBe("firstmate");
  });

  it("keeps slash commands, documents and anything unsure with firstmate", async () => {
    expect(await routeMessage({ ...input, command: "review" }, ask("FLYD"))).toBe("firstmate");
    expect(await routeMessage({ ...input, files: 1 }, ask("FLYD"))).toBe("firstmate");
    expect(await routeMessage(input, ask(new Error("no key")))).toBe("firstmate");
    expect(await routeMessage(input, ask("maybe"))).toBe("firstmate");
    expect(await routeMessage(input, () => new Promise<string>(() => {}), 20)).toBe("firstmate");
  });

  it("keeps a follow-up to Flyd's own answer with Flyd when the router can't tell", async () => {
    // The logged miss: "well why didn't u read the config?" came two minutes after Flyd answered, the router timed out, and it went to firstmate.
    const followUp = { ...input, text: "well why didn't u read the config? and why isn't this in memory?" };
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const timedOut = () => new Promise<string>(() => {});
    expect(await routeMessage({ ...followUp, previous: { owner: "flyd", at: minutesAgo(2) } }, timedOut, 20)).toBe("flyd");
    expect(await routeMessage({ ...followUp, previous: { owner: "flyd", at: minutesAgo(2) } }, ask(new Error("offline")))).toBe("flyd");
    expect(await routeMessage({ ...followUp, previous: { owner: "flyd", at: minutesAgo(2) } }, ask("maybe"))).toBe("flyd");
    // An old conversation, or one firstmate is having, keeps the old default.
    expect(await routeMessage({ ...followUp, previous: { owner: "flyd", at: minutesAgo(45) } }, timedOut, 20)).toBe("firstmate");
    expect(await routeMessage({ ...followUp, previous: { owner: "firstmate", at: minutesAgo(2) } }, timedOut, 20)).toBe("firstmate");
    // A router that answers still decides.
    expect(await routeMessage({ ...followUp, previous: { owner: "flyd", at: minutesAgo(2) } }, ask("FIRSTMATE"))).toBe("firstmate");
  });

  it("tells the router that questions about Flyd itself are Flyd's", () => {
    expect(routePrompt("what models is flyd using?", [])).toMatch(/Questions about Flyd itself \(which models it uses[^)]*\)[^.]*are Flyd's/);
  });

  it("shows the model what firstmate last asked, so a bare answer like 'A' goes back to it", () => {
    const prompt = routePrompt("A", [
      { id: "t1", role: "assistant", aside: true, text: "Sir, should I go with A or B for the island filter?" },
    ]);
    expect(prompt).toContain("Firstmate (update): Sir, should I go with A or B for the island filter?");
    expect(prompt).toContain("New message from George: A");
  });
});

describe("FlydDesk project context", () => {
  it("tracks a resolved project, clears it when absent and changes it on the next turn", async () => {
    let resolved: string | null = "Atomise";
    const desk = new FlydDesk({
      dir: join(dir, "asks"),
      answer: async (_question, _history, _step, turn) => {
        turn?.onUnderstanding({ version: "conversational-presence.v1", route: "answer", source: "room", project: resolved });
        return "Done.";
      },
    });
    desk.ask("First", [], "session");
    await until(() => desk.project("session"));
    expect(desk.project("session")).toBe("Atomise");
    resolved = null;
    desk.ask("No project", [], "session");
    await until(() => desk.exchanges().length === 2 && desk.exchanges()[1]?.answer);
    expect(desk.project("session")).toBeUndefined();
    resolved = "GNM";
    desk.ask("Different project", [], "session");
    await until(() => desk.exchanges().length === 3 && desk.exchanges()[2]?.answer);
    expect(desk.project("session")).toBe("GNM");
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

  it("says Flyd is answering, then shows its own answer under the question", async () => {
    const turn = deferred();
    const desk = new FlydDesk({ dir, answer: turn.answer });
    const sent = desk.ask("  whats there to do in bkk tonight?  ");
    expect(desk.exchanges()).toEqual([{ question: { id: sent.id, role: "user", text: "whats there to do in bkk tonight?", timestamp: sent.timestamp }, waiting: answeringLine("whats there to do in bkk tonight?") }]);

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

  it("gives follow-ups the full list an answer kept in Artefacts", async () => {
    const history: unknown[] = [];
    const desk = new FlydDesk({ dir, answer: async (_question, earlier, _onStep, turn) => {
      history.push(earlier);
      turn?.onArtefact("1. First\n2. Second");
      return "» Two parts.\n\nThe full breakdown is in Artefacts.";
    } });
    desk.ask("status?");
    await until(() => desk.exchanges()[0]?.answer);
    desk.ask("start on item 2");
    expect(history.at(-1)).toEqual([
      { role: "user", content: "status?" },
      { role: "assistant", content: "» Two parts.\n\nThe full breakdown is in Artefacts.\n\n1. First\n2. Second" },
    ]);
  });

  it("keeps his screenshots with the question, and what they show for the answer and every follow-up", async () => {
    const asked: Array<[string, unknown]> = [];
    const desk = new FlydDesk({
      dir,
      see: async (question, images) => `[shows: a 404 page for ${question} (${images.length})]`,
      answer: async (question, history) => {
        asked.push([question, history]);
        return "That is a 404 from the preview server.";
      },
    });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const sent = desk.ask("is this normal?", [{ mediaType: "image/png", data: png }]);
    await until(() => (desk.exchanges()[0]?.answer ? true : undefined));
    const [exchange] = desk.exchanges();
    expect(asked[0]![0]).toBe("is this normal?\n\n[shows: a 404 page for is this normal? (1)]");
    expect(exchange!.question.id).toBe(sent.id);
    expect(exchange!.question.text).toBe("is this normal?");
    expect(exchange!.question.images).toHaveLength(1);
    expect(desk.image(exchange!.question.images![0]!)?.mediaType).toBe("image/png");
    expect(desk.image("a../../etc/passwd")).toBeNull();

    // A follow-up, even from a desk read again after a restart, still knows what the screenshot showed.
    const again = new FlydDesk({ dir, answer: async (question, history) => {
      asked.push([question, history]);
      return "Yes.";
    } });
    again.ask("and how do I fix it?");
    await until(() => (asked.length === 2 ? true : undefined));
    expect(asked[1]![1]).toEqual([
      { role: "user", content: "is this normal?\n\n[shows: a 404 page for is this normal? (1)]" },
      { role: "assistant", content: "That is a 404 from the preview server." },
    ]);
  });

  it("says what Flyd is doing the moment it changes, then its answer", async () => {
    let step: ((line: string) => void) | undefined;
    let resolve!: (text: string) => void;
    const desk = new FlydDesk({ dir, answer: (_question, _history, onStep) => {
      step = onStep;
      return new Promise<string>((res) => { resolve = res; });
    } });
    desk.ask("what models is flyd using?");
    expect(desk.exchanges()[0]!.waiting).toBe(answeringLine("what models is flyd using?"));
    step!("Checking my own setup");
    expect(desk.exchanges()[0]!.waiting).toBe("Checking my own setup");
    step!("Searching the web: gpt-realtime-2.1 release notes…");
    expect(desk.exchanges()[0]!.waiting).toBe("Searching the web: gpt-realtime-2.1 release notes");
    resolve("Chat runs on opencode-go/deepseek-v4.1-flash.");
    const [exchange] = await until(() => (desk.exchanges()[0]?.answer ? desk.exchanges() : undefined));
    expect(exchange!.waiting).toBe("");
    // A step that arrives after the answer is not shown anywhere.
    step!("Thinking it through");
    expect(desk.exchanges()[0]!.answer).toBeDefined();
  });

  it("says when Flyd could not answer, and when a restart cut it off", async () => {
    const turn = deferred();
    const desk = new FlydDesk({ dir, answer: turn.answer });
    desk.ask("what's the weather");
    turn.reject(new Error("model unavailable"));
    await until(() => (desk.exchanges()[0]?.waiting.startsWith("Flyd couldn't") ? true : undefined));
    expect(desk.exchanges()[0]!.waiting).toBe("Flyd couldn't answer this: model unavailable");
    expect(desk.exchanges()[0]!.waitingFailed).toBe(true);

    desk.ask("still there?");
    expect(desk.exchanges()[1]!.waitingFailed).toBeUndefined();
    const restarted = new FlydDesk({ dir, answer: turn.answer });
    expect(restarted.exchanges()[1]!.waiting).toBe("Flyd was interrupted before answering; send it again");
    expect(restarted.exchanges()[1]!.waitingFailed).toBe(true);
    const messages = mergeNotes([], restarted.exchanges(), {});
    expect(statusOf({ messages, working: false }).waiting).toEqual({ id: messages[1]!.id, text: "Flyd was interrupted before answering; send it again", failed: true });
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
    id="$(date +%s)-$(printf '%06d' "$RANDOM")"
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

  it("keeps one quiet living line on a note: working, then the step itself, never the handoff", async () => {
    const project = join(dir, "project");
    const home = join(dir, "firstmate");
    mkdirSync(project);
    mkdirSync(home);
    writeFileSync(join(project, "s1.jsonl"), captain("status?") + "\n");
    const script = join(dir, "fm-inbox.sh");
    writeFileSync(script, FAKE_SCRIPT);
    chmodSync(script, 0o755);
    const source = new ClaudeCodeTranscriptSource({
      projectDir: project,
      inbox: new FirstmateInbox({ home, script }),
      desk: { desk: new FlydDesk({ dir: join(dir, "asks"), answer: async () => "unused" }), complete: async () => "FIRSTMATE" },
      pollMs: 15,
    });
    const sent = await source.send("s1", "the good neighbours market hero is too tall");
    expect(sent.waiting).toBe("");
    let snapshot = await source.read("s1");
    expect(snapshot.messages.find((message) => message.id === sent.id)?.waiting).toBe("");

    // Firstmate reads the note, then busies itself with other work: that work's step is not this note's line.
    const inbox = join(home, "state", "inbox");
    const name = readdirSync(inbox).find((file) => file.endsWith(".note"))!;
    mkdirSync(join(inbox, "handled"));
    writeFileSync(join(inbox, "handled", name), readFileSync(join(inbox, name)));
    rmSync(join(inbox, name));
    writeFileSync(join(project, "s1.jsonl"), [captain("status?"), captain("[note] the hero"), toolUse("Bash", { command: "npm run shrink", description: "Shrink hero on short screens" })].join("\n") + "\n");
    snapshot = await source.read("s1");
    expect(snapshot.messages.find((message) => message.id === sent.id)?.waiting).not.toMatch(/shrink/i);

    // Its turn takes the note up by name and starts work: the step rides on the note's own line.
    writeFileSync(join(project, "s1.jsonl"), [captain("status?"), captain("[note] the hero"), toolUse("Bash", { command: `cat ${join(inbox, "handled", name)}`, description: "Read the note" }), toolUse("Bash", { command: "npm test", description: "Run the site's tests" })].join("\n") + "\n");
    snapshot = await source.read("s1");
    expect(snapshot.messages.find((message) => message.id === sent.id)?.waiting).toBe("Running the site's tests");
    expect(statusOf(snapshot).waiting).toEqual({ id: sent.id, text: "Running the site's tests" });
  });

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

  it("keeps his follow-up to Flyd's answer with Flyd when the router fails, so it never lands in firstmate's inbox", async () => {
    const { source, home, answered } = setup("not a route");
    const first = await source.send("s1", "what models is flyd using?", undefined, undefined, "flyd");
    await until(() => (source.exchanges().find((exchange) => exchange.question.id === first.id)?.answer ? true : undefined));
    const followUp = await source.send("s1", "well why didn't u read the config? and why isn't this in memory?");
    expect(followUp.id).toMatch(/^ask:/);
    await until(() => (answered.length === 2 ? true : undefined));
    expect(answered[1]).toBe("well why didn't u read the config? and why isn't this in memory?");
    expect(readdirSync(home)).not.toContain("state");
  });

  it("sends software work to firstmate, and relays firstmate's own lines as updates in Flyd's voice", async () => {
    const { source, home, answered } = setup("FIRSTMATE");
    const sent = await source.send("s1", "fix the island filter");
    expect(sent.id).toMatch(/^note:/);
    expect(answered).toEqual([]);
    expect(readdirSync(join(home, "state", "inbox")).filter((name) => name.endsWith(".note"))).toHaveLength(1);

    const messages = (await source.read("s1")).messages;
    expect(messages.find((message) => message.id === sent.id)).toMatchObject({ waiting: "Fixing the island filter" });
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
    // A note with no reply still renders, cleanly, with no line until there is something concrete to say.
    const waiting = messages.find((message) => message.id === pending.id)!;
    expect(waiting.waiting ?? "").not.toMatch(/next step/i);
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

  it("still reads firstmate's note answer when the reply is an artefact", async () => {
    const prompts: string[] = [];
    const interpreter = new AnswerInterpreter({
      cacheFile: join(dir, "interpretations.json"),
      profile: () => null,
      complete: async (prompt) => {
        prompts.push(prompt);
        return "Sir, the redirects still point at the old host; delete the catch-all rule and add the general one.";
      },
    });
    let landed!: () => void;
    const arrived = new Promise<void>((resolve) => { landed = resolve; });
    const differ = new SnapshotDiffer({ interpreter, onSummary: () => landed() });
    const messages = noteWithReply(["Captain, fix the redirects.", "1. Delete the catch-all rule.", "2. Add the general rule."].join("\n\n"));

    const shown = differ.next({ messages, working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;
    // The reply is an artefact, so its body is the steps, keeps its own words in the column.
    expect(plain(shown.summary!.html)).toContain("kept in Artefacts");
    await arrived;
    // Flyd still reads it for him, so the column speaks Flyd's reading of the note answer, not firstmate's words.
    expect(prompts).toHaveLength(1);
    expect(interpreter.cached(messages.find((message) => message.answers)!.text)).toContain("delete the catch-all");
  });

  it("leads with a few short lines of the answer, its decision kept, when no interpretation is coming", () => {
    // With no model, the answer's own words lead, held to a glance in Flyd's
    // voice: its outcome and the decision waiting on him, with its link.
    const shown = new SnapshotDiffer().next({ messages: noteWithReply(decision), working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;
    expect(shown.summary).toMatchObject({ source: "brief" });
    expect(shown.summary?.pending).toBeUndefined();
    const lead = plain(shown.summary!.html);
    expect(lead).toContain("The island filter hid two real outcomes last night along with the supervision chatter.");
    expect(lead).toContain("Decide whether to keep the filter: keeping it hides real outcomes; dropping it brings back every status ping.");
    expect(lead).not.toMatch(/captain/i);
    expect(lead).not.toContain("you're right");
  });

  it("never puts a relay naming machinery or a placeholder in front of him, and passes a clean line through as written", async () => {
    const helperReport = "Firstmate needs your call on a composer idle-row guard. Upstream reviewers call this new default behaviour, not a fix.";
    const placeholder = "Working on it";
    const cleanLine = "Reading cli/src/runtime/acceptance.ts to check the done_when gate";
    const relay = async (reply: string, file: string, retelling = reply) => {
      const interpreter = new AnswerInterpreter({ cacheFile: join(dir, file), profile: () => null, complete: async () => retelling });
      const messages = noteWithReply(reply);
      const answer = messages.find((message) => message.answers === `note:${NOTE}`)!.text;
      const shownOf = () => new SnapshotDiffer({ interpreter }).next({ messages, working: false }).messages.find((message) => message.answers === `note:${NOTE}`);
      const first = shownOf();
      const told = await interpreter.request({ question: "q", answer, recent: [] });
      return { told, shown: [first, shownOf()], cached: interpreter.cached(answer) };
    };

    for (const [reply, file] of [[helperReport, "helper.json"], [placeholder, "placeholder.json"]] as const) {
      // The model retells the reply word for word, as a leaky retelling would.
      const { told, shown } = await relay(reply, file);
      expect(told).toBeUndefined();
      // Nothing of it is rendered: no summary, no body behind "more".
      expect(shown).toEqual([undefined, undefined]);
    }
    const verdicts = readFileSync(join(process.env.FLYD_SELF_REVIEW_DIR!, "verdicts.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; held?: boolean; surface?: string });
    expect(verdicts).toContainEqual(expect.objectContaining({ text: helperReport, surface: "relay", held: true }));

    const clean = await relay(cleanLine, "clean.json");
    expect(clean.told).toBe(cleanLine);
    expect(clean.cached).toBe(cleanLine);
    expect(plain(clean.shown[1]!.summary!.html)).toContain("acceptance.ts");
  });

  it("drops a commit id from the staff's own words when they lead, leaving their full reply and its code as written", () => {
    const reply = "Merged at a1b2c3d; the sidebar opens on Artefacts.\n\n```ts\nfetch(url)\n  .then((r) => r.json())\n```";
    const shown = new SnapshotDiffer().next({ messages: noteWithReply(reply), working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;
    const lead = plain(shown.summary!.html);
    expect(lead).toContain("the sidebar opens on Artefacts");
    expect(lead).not.toContain("a1b2c3d");
    expect(plain(shown.html)).toContain("fetch(url)\n  .then(");
  });

  it("records a held relay once, however often the window reconnects", () => {
    const reply = "Firstmate is still on the idle-row guard, nothing to report.";
    const messages = noteWithReply(reply);
    for (let reconnect = 0; reconnect < 3; reconnect += 1) {
      expect(new SnapshotDiffer().next({ messages, working: false }).messages.find((message) => message.answers === `note:${NOTE}`)).toBeUndefined();
    }
    const held = readFileSync(join(process.env.FLYD_SELF_REVIEW_DIR!, "verdicts.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { text: string; source?: string })
      .filter((verdict) => verdict.source === "relay:staff" && verdict.text.includes("idle-row guard, nothing to report"));
    expect(held).toHaveLength(1);
  });

  it("keeps a retelling that carries a commit id, the id dropped", async () => {
    const interpreter = new AnswerInterpreter({ cacheFile: join(dir, "sha.json"), profile: () => null, complete: async () => "The sidebar fix is merged at a1b2c3d." });
    const messages = noteWithReply("Captain, merged the sidebar fix.");
    const answer = messages.find((message) => message.answers === `note:${NOTE}`)!.text;
    expect(await interpreter.request({ question: "q", answer, recent: [] })).toBe("The sidebar fix is merged.");
    const shown = new SnapshotDiffer({ interpreter }).next({ messages, working: false }).messages.find((message) => message.answers === `note:${NOTE}`)!;
    expect(plain(shown.summary!.html)).toContain("The sidebar fix is merged.");
    expect(plain(shown.summary!.html)).not.toContain("a1b2c3d");
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
    expect(snapshot.messages.at(-1)).toMatchObject({ id: "note:1791600000-abc", waiting: "Answered", settled: true });
    expect(statusOf(snapshot).reply?.headline ?? "").not.toMatch(/stale wake/i);
  });

  it("knows a supervision session whose first prompt outgrows the head it scans", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "main.jsonl"), captain("hello", { entrypoint: "cli" }) + "\n");
    writeFileSync(join(project, "supervision.jsonl"), [
      captain(`MAIN DIALOG MIRROR (read-only context)\n\n${"stale: firstmate:flyd-going-silent\n".repeat(3000)}`, sdk),
      assistantText(STALE_WAKE, "end_turn", { entrypoint: "sdk-cli" }),
    ].join("\n") + "\n");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(project, "main.jsonl"), past, past);

    const view = source(project, join(dir, "firstmate"));
    expect((await view.listSessions()).map((session) => session.id)).toEqual(["main"]);
    expect((await view.listSessions()).map((session) => session.id)).toEqual(["main"]);
  });

  it("relays firstmate's answers to its own wakes only when they bring a PR, ask his decision or report a failure, and every background-task report", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "main.jsonl"), [
      captain("how's the island?"),
      assistantText("Captain, the island filter is back on and working, and the going-silent fix is ready: https://github.com/GeorgeGally/flyd/pull/84"),
      injection(WAKE),
      assistantText("The stale wake for the Good Neighbours site worker was a false alarm. The worker isn't wedged.\n\nI took no action and reported it to MAIN as a silent routine outcome. The wake is acknowledged."),
      injection(WAKE),
      assistantText("Captain, the settings screen is ready to merge: https://github.com/GeorgeGally/flyd/pull/90. PR 84 (https://github.com/GeorgeGally/flyd/pull/84) is still waiting on your merge."),
      injection(WAKE),
      assistantText("The worker isn't blocked; no action needed."),
      injection(WAKE),
      assistantText("PR 84 is still waiting on your merge; no checks failed."),
      injection(WAKE),
      assistantText("Nothing failed and no tests have failed; none failed overnight."),
      injection(WAKE),
      assistantText("The worker finished without being blocked."),
      injection(WAKE),
      assistantText("Captain, the Good Neighbours worker failed its build twice and stopped."),
      injection(WAKE),
      assistantText("Captain, the lab page has two layouts. Should I keep the grid or the list?"),
      injection(WAKE),
      assistantText(STALE_WAKE),
      injection("<task-notification>\n<task-id>b7f2</task-id>\n<status>completed</status>\n<summary>Background command \"Deploy\" completed (exit code 0)</summary>\n</task-notification>"),
      assistantText("Captain, deployed and all tests pass; landed on main."),
    ].join("\n") + "\n");

    const snapshot = await source(project, join(dir, "firstmate")).read("main");
    const relays = snapshot.messages.filter((message) => message.role === "assistant");
    expect(relays.map((message) => message.text)).toEqual([
      "Sir, the island filter is back on and working, and the going-silent fix is ready: https://github.com/GeorgeGally/flyd/pull/84",
      "Sir, the settings screen is ready to merge: https://github.com/GeorgeGally/flyd/pull/90. PR 84 (https://github.com/GeorgeGally/flyd/pull/84) is still waiting on your merge.",
      "Sir, the Good Neighbours worker failed its build twice and stopped.",
      "Sir, the lab page has two layouts. Should I keep the grid or the list?",
      "Sir, deployed and all tests pass; landed on main.",
    ]);
    // The island reads the same snapshot, so it names only what the window shows.
    expect(relays.map((message) => message.id)).toContain(statusOf(snapshot).reply?.id);
  });

  it("keeps his own message that quotes a watcher wake, and firstmate's answer to it", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "main.jsonl"), [
      captain("why does \"firstmate watcher wake - one supervision event needs a handling turn now\" keep showing?"),
      assistantText("Captain, the Stop hook prints it whenever a supervision event is parked."),
    ].join("\n") + "\n");

    const snapshot = await source(project, join(dir, "firstmate")).read("main");
    expect(snapshot.messages.map((message) => message.text)).toEqual([
      "why does \"firstmate watcher wake - one supervision event needs a handling turn now\" keep showing?",
      "Sir, the Stop hook prints it whenever a supervision event is parked.",
    ]);
  });
});

it('threads an exact finalized turn identity and renders checked preparation without copying its content', async () => {
  const { PreparationStore } = await import('../../runtime/preparation-store.js');
  const store = new PreparationStore({ path: join(dir, 'initiative.sqlite') });
  const grantSource = { turnId: 'grant-1', sessionId: 'view:test-session', text: 'Keep preparing Christmas sponsor drafts', revision: 1, consentRef: 'view:test-session' };
  const remit = store.registerRemit(grantSource, { goal: 'Christmas sponsors', providerIdentity: 'test/model' });
  const desk = new FlydDesk({ dir: join(dir, 'asks'), preparationStore: store,
    answer: async (text, _history, _step, turn) => {
      expect(turn?.source.text).toBe(text);
      expect(turn?.source.final).toBe(true);
      const source = turn!.source;
      const claim = store.claim(source, { remitId: remit.id, sourceSpan: text, outcome: 'A sponsor follow-up' });
      if (!claim.accepted) throw Error('not accepted');
      turn!.onPreparation(claim.attempt.id);
      store.complete(claim.attempt.id, { content: 'Hello, following up on the Christmas sponsorship conversation.', evidenceRefs: [source.turnId] });
      return 'I prepared a follow-up draft.';
    },
  });
  desk.ask('The sponsor has not replied', [], 'test-session');
  await until(() => desk.exchanges()[0]?.answer);
  expect(desk.exchanges()[0].answer?.text).toContain('Hello, following up');
  const saved = readFileSync(join(dir, 'asks', readdirSync(join(dir, 'asks')).find(name => name.endsWith('.json'))!), 'utf8');
  expect(saved).not.toContain('Hello, following up');
  store.erase('view:test-session');
  expect(desk.exchanges()[0].answer?.text).not.toContain('Hello, following up');
});
