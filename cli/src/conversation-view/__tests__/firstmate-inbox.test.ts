import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox, mergeNotes } from "../firstmate-inbox.js";
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
    const notes = inbox.notes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: sent.id, role: "user", text });
    expect(readdirSync(dir)).not.toContain("pwned");
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
    expect(inbox.notes().map((note) => [note.id, note.text])).toEqual([[sent.id, "are you there?"]]);
  });

  it("reads each note file once, including after firstmate moves it to handled/", () => {
    writeNote("", "100-a", "2026-10-05T20:00:00Z", "first");
    const inbox = new FirstmateInbox({ home, script: join(dir, "missing.sh") });
    expect(inbox.notes().map((note) => note.text)).toEqual(["first"]);

    // Unreadable from here on: only a re-read would lose it.
    const pendingPath = join(home, "state", "inbox", "100-a.note");
    chmodSync(pendingPath, 0o000);
    mkdirSync(join(home, "state", "inbox", "handled"));
    renameSync(pendingPath, join(home, "state", "inbox", "handled", "100-a.note"));
    writeNote("", "200-b", "2026-10-05T20:05:00Z", "second");
    expect(inbox.notes().map((note) => note.text)).toEqual(["first", "second"]);

    rmSync(join(home, "state", "inbox", "handled", "100-a.note"));
    expect(inbox.notes().map((note) => note.text)).toEqual(["second"]);
  });

  it("reads notes both pending and already handled by firstmate, oldest first", () => {
    writeNote("handled", "200-b", "2026-10-05T20:10:00Z", "second");
    writeNote("", "100-a", "2026-10-05T20:00:00Z", "first\nwith two lines");
    writeFileSync(join(home, "state", "inbox", ".staging-xyz"), "half written");
    const inbox = new FirstmateInbox({ home, script: join(dir, "missing.sh") });
    expect(inbox.available()).toBe(false);
    expect(inbox.notes().map((note) => [note.id, note.text])).toEqual([
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
  const note = (id: string, timestamp: string) => ({ id, role: "user" as const, text: id, timestamp });

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
