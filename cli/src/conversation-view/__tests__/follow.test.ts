import { appendFileSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { LineFollower } from "../line-follower.js";
import type { ConversationSnapshot } from "../types.js";
import { assistantText, attachment, captain, captainBlocks, title, toolResult, toolUse } from "./transcript-fixture.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-view-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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

function readAll(follower: LineFollower): string[] {
  const lines: string[] = [];
  follower.readNew((line) => lines.push(line));
  return lines;
}

describe("LineFollower", () => {
  it("returns only appended complete lines and holds back a partial one", () => {
    const path = join(dir, "s.jsonl");
    writeFileSync(path, "one\ntwo\nthr");
    const follower = new LineFollower(path);
    expect(readAll(follower)).toEqual(["one", "two"]);
    expect(readAll(follower)).toEqual([]);
    appendFileSync(path, "ee\nfour\n");
    expect(readAll(follower)).toEqual(["three", "four"]);
  });

  it("does not split a multi-byte character across reads", () => {
    const path = join(dir, "s.jsonl");
    const bytes = Buffer.from("café ✓\n", "utf8");
    writeFileSync(path, bytes.subarray(0, 4));
    const follower = new LineFollower(path);
    expect(readAll(follower)).toEqual([]);
    appendFileSync(path, bytes.subarray(4));
    expect(readAll(follower)).toEqual(["café ✓"]);
  });

  it("reports each line's starting byte, counting multi-byte characters", () => {
    const path = join(dir, "s.jsonl");
    writeFileSync(path, "a\né✓\n\nccc\n");
    const seen: Array<[string, number]> = [];
    new LineFollower(path).readNew((line, offset) => seen.push([line, offset]));
    expect(seen).toEqual([["a", 0], ["é✓", 2], ["ccc", 9]]);
  });

  it("starts over when the file is truncated", () => {
    const path = join(dir, "s.jsonl");
    writeFileSync(path, "a long first line\n");
    const follower = new LineFollower(path);
    readAll(follower);
    writeFileSync(path, "new\n");
    const events: string[] = [];
    const count = follower.readNew(
      (line) => events.push(line),
      () => events.push("<truncated>"),
    );
    expect(count).toBe(1);
    expect(events).toEqual(["<truncated>", "new"]);
  });

  it("delivers lines of a multi-megabyte file intact across read chunks", () => {
    const path = join(dir, "s.jsonl");
    const expected = Array.from({ length: 3000 }, (_, i) => `${i}:${"é".repeat(500 + (i % 7))}`);
    writeFileSync(path, expected.join("\n") + "\n");
    const follower = new LineFollower(path);
    const seen: string[] = [];
    expect(follower.readNew((line) => seen.push(line))).toBe(expected.length);
    expect(seen).toEqual(expected);
  });
});

describe("ClaudeCodeTranscriptSource", () => {
  it("follows a transcript as lines are appended, without writing to it", async () => {
    const path = join(dir, "abc-123.jsonl");
    writeFileSync(path, [title("Building the view"), captain("build the view")].join("\n") + "\n");
    const source = new ClaudeCodeTranscriptSource({ projectDir: dir, pollMs: 15 });

    const updates: ConversationSnapshot[] = [];
    const follower = source.follow("abc-123", (snapshot) => updates.push(snapshot));
    try {
      expect(updates).toHaveLength(1);
      expect(updates[0]!.messages.map((m) => m.text)).toEqual(["build the view"]);
      expect(updates[0]!.working).toBe(true);

      // Tool noise alone changes nothing visible but still reports progress.
      appendFileSync(path, [toolUse(), toolResult("ok")].join("\n") + "\n");
      await until(() => (updates.length >= 2 ? true : undefined));
      expect(updates.at(-1)!.messages).toHaveLength(1);

      // A reply written in two pieces, the first without its newline.
      const reply = assistantText("Captain, the view is live.");
      appendFileSync(path, reply.slice(0, 40));
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(updates.at(-1)!.messages).toHaveLength(1);
      appendFileSync(path, reply.slice(40) + "\n");
      const settled = await until(() => {
        const last = updates.at(-1)!;
        return last.messages.length === 2 ? last : undefined;
      });
      expect(settled.messages[1]).toMatchObject({ role: "assistant", text: "Captain, the view is live." });
      expect(settled.working).toBe(false);
    } finally {
      follower.close();
    }
    expect(readFileSync(path, "utf8").endsWith("Captain, the view is live.\"}],\"stop_reason\":\"end_turn\"}}\n")).toBe(true);
  });

  it("shows pasted images in place of their [Image #N] markers and reads them back from the transcript", async () => {
    const path = join(dir, "imgs.jsonl");
    writeFileSync(path, [
      captain("plain text first"),
      assistantText("ok"),
      captainBlocks([{ type: "text", text: "[Image #7] mobile spacing is off" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }]),
      attachment({ type: "queued_command", commandMode: "prompt", origin: { kind: "human" }, source_uuid: "q1", prompt: [{ type: "text", text: "and this [Image #8]" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }] }),
    ].join("\n") + "\n");
    const source = new ClaudeCodeTranscriptSource({ projectDir: dir });

    const messages = (await source.read("imgs")).messages.filter((m) => m.role === "user");
    expect(messages.map((m) => [m.text, m.images?.length ?? 0])).toEqual([["plain text first", 0], ["mobile spacing is off", 1], ["and this", 1]]);
    for (const message of messages.slice(1)) {
      const image = await source.image("imgs", message.images![0]!);
      expect(image).toEqual({ mediaType: "image/png", data: Buffer.from(PNG, "base64") });
    }
    expect(await source.image("imgs", "t0.0")).toBeNull();
    expect(await source.image("imgs", "t999999.0")).toBeNull();
    expect(await source.image("imgs", "../../etc/passwd")).toBeNull();
  });

  it("lists sessions newest first with their titles", async () => {
    const older = [title("Older work"), captain("hi")].join("\n") + "\n";
    writeFileSync(join(dir, "older.jsonl"), older);
    writeFileSync(join(dir, "newer.jsonl"), [captain("what is the status of the lab page")].join("\n") + "\n");
    writeFileSync(join(dir, "notes.txt"), "not a transcript");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(dir, "older.jsonl"), past, past);

    const source = new ClaudeCodeTranscriptSource({ projectDir: dir });
    const sessions = await source.listSessions();
    expect(sessions.map((s) => [s.id, s.title])).toEqual([
      ["newer", "what is the status of the lab page"],
      ["older", "Older work"],
    ]);
    expect(readFileSync(join(dir, "older.jsonl"), "utf8")).toBe(older);
  });

  it("rescans a session title only when the transcript's size or mtime changes", async () => {
    const path = join(dir, "s1.jsonl");
    const stamp = new Date(Date.now() - 60_000);
    writeFileSync(path, [title("First title"), captain("hi")].join("\n") + "\n");
    utimesSync(path, stamp, stamp);
    const source = new ClaudeCodeTranscriptSource({ projectDir: dir });
    expect((await source.listSessions()).map((s) => s.title)).toEqual(["First title"]);

    // Same size and mtime: the cached title stands, the file is not rescanned.
    writeFileSync(path, [title("Other title"), captain("hi")].join("\n") + "\n");
    utimesSync(path, stamp, stamp);
    expect((await source.listSessions()).map((s) => s.title)).toEqual(["First title"]);

    const later = new Date(stamp.getTime() + 1000);
    utimesSync(path, later, later);
    expect((await source.listSessions()).map((s) => s.title)).toEqual(["Other title"]);
  });

  it("refuses session ids that would escape the project dir", async () => {
    const source = new ClaudeCodeTranscriptSource({ projectDir: dir });
    await expect(source.read("../../etc/passwd")).rejects.toThrow(/Invalid session id/);
  });
});
