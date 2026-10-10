import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox, mergeNotes, relayed } from "../firstmate-inbox.js";
import type { ConversationSnapshot } from "../types.js";
import { assistantText, captain } from "./transcript-fixture.js";

// A stand-in for firstmate's bin/fm-inbox.sh with the same `note -` contract:
// body on stdin, a note file under $FM_HOME/state/inbox, "queued <id>" on stdout.
// Tests never run the real script, which would wake firstmate.
const FAKE_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "note" ] && [ "$2" = "-" ] || { echo "usage" >&2; exit 2; }
body=$(cat)
[ -n "\${body//[[:space:]]/}" ] || { echo "fm-inbox: refusing to queue an empty note" >&2; exit 1; }
mkdir -p "$FM_HOME/state/inbox"
id="$(date +%s)-$RANDOM$RANDOM"
printf 'id=%s\\nat=%s\\nsource=text\\n--\\n%s\\n' "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$body" > "$FM_HOME/state/inbox/$id.note"
printf 'queued %s\\n  %s\\n' "$id" "$body"
`;

let dir: string;
let home: string;

const questions = (inbox: FirstmateInbox) => inbox.notes().map((exchange) => exchange.question);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function writeScript(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}

function writeNote(sub: string, id: string, at: string, body: string): void {
  const target = join(home, "state", "inbox", sub);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${id}.note`), `id=${id}\nat=${at}\nsource=text\n--\n${body}\n`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-view-inbox-"));
  home = join(dir, "firstmate");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FirstmateInbox", () => {
  it("hands the text to fm-inbox.sh on stdin with FM_HOME, never through a shell", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    const text = `run the flyd viewer "now"; $(touch ${join(dir, "pwned")}) \`id\``;
    const sent = await inbox.send(`  ${text}\n`);

    expect(sent.id).toMatch(/^note:\d+-\d+$/);
    const notes = questions(inbox);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: sent.id, role: "user", text });
    expect(readdirSync(dir)).not.toContain("pwned");
  });

  it("saves pasted images under data/inbox-images and names them in the note for firstmate", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    const sent = await inbox.send("look at this", [{ mediaType: "image/png", data: PNG }]);

    const saved = readdirSync(join(home, "data", "inbox-images"));
    expect(saved).toHaveLength(1);
    const path = join(home, "data", "inbox-images", saved[0]!);
    expect(readFileSync(path)).toEqual(Buffer.from(PNG, "base64"));
    const raw = readFileSync(join(home, "state", "inbox", readdirSync(join(home, "state", "inbox")).find((f) => f.endsWith(".note"))!), "utf8");
    expect(raw).toContain(`look at this\n\n[image: ${path}]`);

    const [note] = questions(inbox);
    expect(note).toMatchObject({ id: sent.id, text: "look at this", images: [`f${saved[0]}`] });
    expect(inbox.image(note!.images![0]!)).toEqual({ mediaType: "image/png", data: Buffer.from(PNG, "base64") });

    // An image alone is a message too.
    await inbox.send("", [{ mediaType: "image/png", data: PNG }]);
    expect(questions(inbox)[1]).toMatchObject({ text: "", images: [expect.stringMatching(/^f.+\.png$/)] });
  });

  it("refuses files that are not images, too many images, and image names outside its folder", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    await expect(inbox.send("x", [{ mediaType: "image/png", data: Buffer.from("#!/bin/sh\nrm -rf ~").toString("base64") }])).rejects.toThrow("Only PNG, JPEG, GIF and WebP");
    await expect(inbox.send("x", Array.from({ length: 5 }, () => ({ mediaType: "image/png", data: PNG })))).rejects.toThrow("At most 4 images");
    expect(questions(inbox)).toEqual([]);

    writeNote("", "300-c", "2026-10-05T20:00:00Z", `see\n[image: /etc/passwd]\n[image: ${join(home, "data", "inbox-images")}/../../x.png]`);
    expect(questions(inbox)[0]).toMatchObject({ text: expect.stringContaining("[image: /etc/passwd]") });
    expect(questions(inbox)[0]!.images).toBeUndefined();
    expect(inbox.image("f../../x.png")).toBeNull();
  });

  it("saves dropped documents under their own names in data/inbox-files and names them in the note for firstmate", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    const pdf = Buffer.from("%PDF-1.3\nhello\n%%EOF\n");
    const sent = await inbox.send("read this", [], undefined, [
      { name: "Q3 report (final).pdf", data: pdf.toString("base64") },
      { name: "../../notes.md", data: Buffer.from("# notes").toString("base64") },
    ]);

    const raw = readFileSync(join(home, "state", "inbox", readdirSync(join(home, "state", "inbox")).find((f) => f.endsWith(".note"))!), "utf8");
    const paths = Array.from(raw.matchAll(/^\[file: (.+)\]$/gm), (match) => match[1]!);
    expect(paths.map((path) => path.split("/").pop())).toEqual(["Q3 report (final).pdf", "notes.md"]);
    for (const path of paths) expect(path.startsWith(join(home, "data", "inbox-files") + "/")).toBe(true);
    expect(readFileSync(paths[0]!)).toEqual(pdf);
    expect(raw).toContain(`read this\n\n[file: ${paths[0]}]\n[file: ${paths[1]}]`);

    expect(questions(inbox)[0]).toMatchObject({ id: sent.id, text: "read this", files: ["Q3 report (final).pdf", "notes.md"] });

    // A document alone is a message too.
    await inbox.send("", [], undefined, [{ name: "brief.docx", data: Buffer.from("PK\x03\x04rest").toString("base64") }]);
    expect(questions(inbox)[1]).toMatchObject({ text: "", files: ["brief.docx"] });
  });

  it("refuses documents it cannot pass on, and file names outside its folder", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    const doc = (name: string, body: string) => ({ name, data: Buffer.from(body).toString("base64") });
    await expect(inbox.send("x", [], undefined, [doc("setup.exe", "MZ")])).rejects.toThrow("setup.exe: only PDFs");
    await expect(inbox.send("x", [], undefined, [doc("fake.pdf", "#!/bin/sh")])).rejects.toThrow("fake.pdf is not a PDF file");
    await expect(inbox.send("x", [], undefined, [doc("blob.txt", "a\u0000b")])).rejects.toThrow("not a TXT file");
    await expect(inbox.send("x", [], undefined, Array.from({ length: 5 }, () => doc("a.md", "a")))).rejects.toThrow("At most 4 documents");
    expect(questions(inbox)).toEqual([]);

    writeNote("", "300-c", "2026-10-05T20:00:00Z", `see\n[file: /etc/passwd]\n[file: ${join(home, "data", "inbox-files")}/1-ab/../x.pdf]`);
    expect(questions(inbox)[0]).toMatchObject({ text: expect.stringContaining("[file: /etc/passwd]") });
    expect(questions(inbox)[0]!.files).toBeUndefined();
  });

  it("tells firstmate to run a slash command the captain picked, and hides that note in the conversation", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    await inbox.send("/design-review the cards look flat", [], "design-review");
    const raw = readFileSync(join(home, "state", "inbox", readdirSync(join(home, "state", "inbox")).find((f) => f.endsWith(".note"))!), "utf8");
    expect(raw).toContain("/design-review the cards look flat\n\n[Captain ran /design-review from Flyd: run it exactly as if he had typed it in Claude Code.]");
    expect(questions(inbox)[0]!.text).toBe("/design-review the cards look flat");
  });

  it("reports the script's own refusal", async () => {
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", "#!/bin/sh\necho 'fm-inbox: firstmate was NOT woken' >&2\nexit 1\n") });
    await expect(inbox.send("hello")).rejects.toThrow("firstmate did not take the message: fm-inbox: firstmate was NOT woken");
    await expect(inbox.send("   ")).rejects.toThrow("Nothing to send");
  });

  it("treats a saved note whose wake failed as delivered, with a warning, so it is never resent", async () => {
    // fm-inbox.sh publishes the note and prints `queued <id>` before waking
    // firstmate; a failed wake then exits non-zero.
    const script = writeScript("fm-inbox.sh", FAKE_SCRIPT.replace(/\n$/, "\necho \"fm-inbox: note $id is saved but firstmate was NOT woken\" >&2\nexit 1\n"));
    const inbox = new FirstmateInbox({ home, script });
    const sent = await inbox.send("are you there?");
    expect(sent.warning).toMatch(/^fm-inbox: note \S+ is saved but firstmate was NOT woken$/);
    expect(questions(inbox).map((note) => [note.id, note.text])).toEqual([[sent.id, "are you there?"]]);
  });

  it("reads each note file once, including after firstmate moves it to handled/", () => {
    writeNote("", "100-a", "2026-10-05T20:00:00Z", "first");
    const inbox = new FirstmateInbox({ home, script: join(dir, "missing.sh") });
    expect(questions(inbox).map((note) => note.text)).toEqual(["first"]);

    // Unreadable from here on: only a re-read would lose it.
    const pendingPath = join(home, "state", "inbox", "100-a.note");
    chmodSync(pendingPath, 0o000);
    mkdirSync(join(home, "state", "inbox", "handled"));
    renameSync(pendingPath, join(home, "state", "inbox", "handled", "100-a.note"));
    writeNote("", "200-b", "2026-10-05T20:05:00Z", "second");
    expect(questions(inbox).map((note) => note.text)).toEqual(["first", "second"]);

    rmSync(join(home, "state", "inbox", "handled", "100-a.note"));
    expect(questions(inbox).map((note) => note.text)).toEqual(["second"]);
  });

  it("reads notes both pending and already handled by firstmate, oldest first", () => {
    writeNote("handled", "200-b", "2026-10-05T20:10:00Z", "second");
    writeNote("", "100-a", "2026-10-05T20:00:00Z", "first\nwith two lines");
    writeFileSync(join(home, "state", "inbox", ".staging-xyz"), "half written");
    const inbox = new FirstmateInbox({ home, script: join(dir, "missing.sh") });
    expect(inbox.available()).toBe(false);
    expect(questions(inbox).map((note) => [note.id, note.text])).toEqual([
      ["note:100-a", "first\nwith two lines"],
      ["note:200-b", "second"],
    ]);
  });
});

describe("mergeNotes", () => {
  const messages = [
    { id: "u1", role: "user" as const, text: "a", timestamp: "2026-10-05T20:00:00.500Z" },
    { id: "r1", role: "assistant" as const, text: "b", timestamp: "2026-10-05T20:05:00.000Z" },
  ];
  const note = (id: string, timestamp: string) => ({ question: { id, role: "user" as const, text: id, timestamp }, waiting: "passed to firstmate" });

  it("places notes by time inside the session's window only", () => {
    const merged = mergeNotes(
      messages,
      [note("early", "2026-10-05T19:00:00Z"), note("mid", "2026-10-05T20:01:00Z"), note("late", "2026-10-05T20:09:00Z"), note("next-session", "2026-10-05T21:00:00Z")],
      { from: "2026-10-05T19:30:00Z", until: "2026-10-05T20:30:00Z" },
    );
    expect(merged.map((m) => m.id)).toEqual(["u1", "mid", "r1", "late"]);
  });

  it("compares times, not strings of different precision", () => {
    expect(mergeNotes(messages, [note("same-second", "2026-10-05T20:00:00Z")], {}).map((m) => m.id)).toEqual(["same-second", "u1", "r1"]);
  });
});

function writeReply(id: string, at: string, seq: number, body: string): void {
  const target = join(home, "state", "inbox", ".replies");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, id), `id=${id}\nat=${at}\nseq=${seq}\n--\n${body}\n`);
}

describe("firstmate's replies to notes", () => {
  const question = "whats there to do in bkk tonight? i see there is an art festival?";
  const unrelated = { id: "t1", role: "assistant" as const, text: "Captain, the island filter is still paused on your call.", timestamp: "2026-10-09T03:21:30.000Z" };

  it("pairs a reply with its own note id, in Flyd's voice", () => {
    writeNote("handled", "1791516064-ZGKFlI", "2026-10-09T03:21:04Z", question);
    writeNote("handled", "1791516100-other1", "2026-10-09T03:21:40Z", "A");
    writeReply("1791516064-ZGKFlI", "2026-10-09T03:22:45Z", 1, "Captain, tonight's the big one: art bangkok at Siam Paragon.");
    const [bkk, other] = new FirstmateInbox({ home }).notes();
    expect(bkk!.answer).toMatchObject({ id: "note-reply:1791516064-ZGKFlI", role: "assistant", answers: "note:1791516064-ZGKFlI", text: "Sir, tonight's the big one: art bangkok at Siam Paragon." });
    expect(other!.answer).toBeUndefined();
  });

  it("never shows an unrelated firstmate line that arrived first as the answer", () => {
    writeNote("handled", "1791516064-ZGKFlI", "2026-10-09T03:21:04Z", question);
    writeReply("1791516064-ZGKFlI", "2026-10-09T03:22:45Z", 1, "Tonight: art bangkok at Siam Paragon.");
    const merged = mergeNotes(relayed([unrelated]), new FirstmateInbox({ home }).notes(), {});
    expect(merged.map((m) => [m.id, m.role, m.aside ?? false])).toEqual([
      ["note:1791516064-ZGKFlI", "user", false],
      ["note-reply:1791516064-ZGKFlI", "assistant", false],
      ["t1", "assistant", true],
    ]);
    expect(merged[2]!.text).toBe("Sir, the island filter is still paused on your call.");
  });

  it("shows the question waiting until its reply arrives, then the reply under it", () => {
    writeNote("", "1791516064-ZGKFlI", "2026-10-09T03:21:04Z", question);
    const inbox = new FirstmateInbox({ home });
    let merged = mergeNotes(relayed([unrelated]), inbox.notes(), {});
    expect(merged.map((m) => [m.id, m.waiting])).toEqual([["note:1791516064-ZGKFlI", "Flyd has it queued"], ["t1", undefined]]);

    mkdirSync(join(home, "state", "inbox", "handled"));
    renameSync(join(home, "state", "inbox", "1791516064-ZGKFlI.note"), join(home, "state", "inbox", "handled", "1791516064-ZGKFlI.note"));
    expect(mergeNotes([], inbox.notes(), {})[0]!.waiting).toBe("Flyd is on it");

    writeReply("1791516064-ZGKFlI", "2026-10-09T03:22:45Z", 1, "Tonight: art bangkok.");
    merged = mergeNotes(relayed([unrelated]), inbox.notes(), {});
    expect(merged.map((m) => [m.id, m.waiting])).toEqual([
      ["note:1791516064-ZGKFlI", undefined],
      ["note-reply:1791516064-ZGKFlI", undefined],
      ["t1", undefined],
    ]);
  });
});

describe("ClaudeCodeTranscriptSource with an inbox", () => {
  it("sends through the inbox and shows the sent message in the followed session, after firstmate files it too", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    const transcript = [captain("hello"), assistantText("Hi, Captain.")].join("\n") + "\n";
    writeFileSync(join(project, "s1.jsonl"), transcript);
    const inbox = new FirstmateInbox({ home, script: writeScript("fm-inbox.sh", FAKE_SCRIPT) });
    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox, pollMs: 15 });
    expect(source.canSend).toBe(true);

    const updates: ConversationSnapshot[] = [];
    const follower = source.follow("s1", (snapshot) => updates.push(snapshot));
    try {
      const sent = await source.send("s1", "run the flyd viewer");
      const shown = await until(() => updates.at(-1)!.messages.find((message) => message.id === sent.id));
      expect(shown).toMatchObject({ role: "user", text: "run the flyd viewer" });

      // Firstmate draining the note moves it to handled/; it stays in view.
      const name = readdirSync(join(home, "state", "inbox")).find((file) => file.endsWith(".note"))!;
      mkdirSync(join(home, "state", "inbox", "handled"));
      renameSync(join(home, "state", "inbox", name), join(home, "state", "inbox", "handled", name));
      expect((await source.read("s1")).messages.map((m) => m.text)).toEqual(["hello", "Hi, Captain.", "run the flyd viewer"]);
    } finally {
      follower.close();
    }
    expect(readFileSync(join(project, "s1.jsonl"), "utf8")).toBe(transcript);
  });

  it("marks only messages that start with a real skill or command", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "s1.jsonl"), captain("hello") + "\n");
    const claude = join(dir, "claude");
    mkdirSync(join(claude, "skills", "design-review"), { recursive: true });
    writeFileSync(join(claude, "skills", "design-review", "SKILL.md"), "---\nname: design-review\ndescription: QA\n---\n");
    const sent: Array<string | undefined> = [];
    const inbox = { send: async (_t: string, _i?: unknown, command?: string) => (sent.push(command), { id: "note:1", timestamp: "x" }), notes: () => [], image: () => null };
    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox, commandRoots: { claudeHome: claude } });
    expect((await source.commands()).map((c) => c.name)).toEqual(["design-review"]);
    await source.send("s1", "/design-review make it nicer");
    await source.send("s1", "/not-real please");
    await source.send("s1", "plain words");
    expect(sent).toEqual(["design-review", undefined, undefined]);
  });

  it("still sends when a commands folder holds a dangling symlink", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "s1.jsonl"), captain("hello") + "\n");
    const claude = join(dir, "claude");
    mkdirSync(join(claude, "commands"), { recursive: true });
    writeFileSync(join(claude, "commands", "ship.md"), "Ship it.\n");
    symlinkSync(join(dir, "missing.md"), join(claude, "commands", "gone.md"));
    const sent: Array<string | undefined> = [];
    const inbox = { send: async (_t: string, _i?: unknown, command?: string) => (sent.push(command), { id: "note:1", timestamp: "x" }), notes: () => [], image: () => null };
    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox, commandRoots: { claudeHome: claude } });
    await source.send("s1", "/ship now");
    await source.send("s1", "plain words");
    expect(sent).toEqual(["ship", undefined]);
  });

  it("is read-only without an inbox", async () => {
    const project = join(dir, "project");
    mkdirSync(project);
    writeFileSync(join(project, "s1.jsonl"), captain("hello") + "\n");
    const source = new ClaudeCodeTranscriptSource({ projectDir: project });
    expect(source.canSend).toBe(false);
    await expect(source.send("s1", "hi")).rejects.toThrow("read-only");
  });
});

async function until<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for update");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
