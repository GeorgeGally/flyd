import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox } from "../firstmate-inbox.js";
import { followUps, inlineOutcomes, withFollowUps } from "../follow-ups.js";
import { imageSize, isHisImage, ReplyShots } from "../reply-shots.js";
import { toolImageAt, TranscriptConversation } from "../transcript-filter.js";
import type { ConversationMessage, Exchange } from "../types.js";
import { assistantText, injection, toolUse } from "./transcript-fixture.js";

/** A PNG header of the given size: enough for sniffing and sizing. */
function png(width: number, height: number, fill = 0): Buffer {
  const bytes = Buffer.alloc(64, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

let tool = 0;
/** The assistant opening a file with Read, and the image its Read returned. */
function readImage(path: string, image: Buffer): [string, string] {
  const id = `toolu_read${++tool}`;
  const use = JSON.stringify({
    type: "assistant",
    uuid: `${id}-use`,
    timestamp: "2026-10-11T13:01:02.000Z",
    message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id, name: "Read", input: { file_path: path } }], stop_reason: "tool_use" },
  });
  const result = JSON.stringify({
    type: "user",
    uuid: `${id}-result`,
    timestamp: "2026-10-11T13:01:03.000Z",
    message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } }] }] },
  });
  return [use, result];
}

const NOTE = "1791723632-nmWTmQ";
const takeNote = (id = NOTE): string => toolUse("Bash", { command: `sed -n '/^--$/,$p' /fm/state/inbox/${id}.note` });
const SHOT = "/private/tmp/claude-501/fm/scratchpad/f.png";

/** Folds lines with their byte offsets, as the source reads a transcript. */
function fold(lines: string[]): { conversation: TranscriptConversation; text: string } {
  const conversation = new TranscriptConversation();
  let offset = 0;
  for (const line of lines) {
    conversation.pushLine(line, offset);
    offset += Buffer.byteLength(line) + 1;
  }
  return { conversation, text: `${lines.join("\n")}\n` };
}

const replies = (conversation: TranscriptConversation): ConversationMessage[] =>
  conversation.snapshot().messages.filter((message) => message.role === "assistant");

describe("the screenshot behind a reply", () => {
  it("is the last screenshot the turn read after taking up its note", () => {
    const first = readImage(SHOT, png(400, 300));
    const last = readImage(SHOT, png(1067, 500));
    const lines = [injection("firstmate watcher wake"), takeNote(), ...first, ...last, assistantText("Captain, Get directions now sits below the map.")];
    const { conversation } = fold(lines);
    const [reply] = replies(conversation);
    const offset = lines.slice(0, 5).reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
    expect(reply!.shots).toEqual([`t${offset}.0`]);
    expect(toolImageAt(JSON.parse(lines[5]!), 0)?.data).toBe(png(1067, 500).toString("base64"));
  });

  it("ignores a screenshot from before the note, his own pasted images, and other files", () => {
    const { conversation } = fold([
      injection("firstmate watcher wake"),
      ...readImage(SHOT, png(400, 300)),
      takeNote(),
      ...readImage("/fm/data/inbox-images/1791725531564-35c10bb6.png", png(856, 454)),
      ...readImage("/fm/data/flyd-reply-screenshots/captain-screenshot.png", png(856, 454)),
      ...readImage("/fm/state/inbox/handled/x.note", png(10, 10)),
      assistantText("Captain, a worker is on it."),
    ]);
    expect(replies(conversation)[0]!.shots).toBeUndefined();
  });

  it("goes with a note only from the turn that handled it", () => {
    const exchanges: Exchange[] = [
      { question: { id: `note:${NOTE}`, role: "user", text: "put get directions button below the map", timestamp: "2026-10-11T13:00:32Z" }, waiting: "", handoff: "taken", takenAt: "2026-10-11T13:00:40Z" },
    ];
    const handled: ConversationMessage = { id: "r1", role: "assistant", text: "Captain, Get directions now sits below the map on Find us.", timestamp: "2026-10-11T13:02:04Z", notes: [NOTE], shots: ["t10.0"] };
    expect(followUps(exchanges, [handled])[`note:${NOTE}`]!.shots).toEqual(["t10.0"]);
    // A later report about the same thing, from a turn that never named the note.
    const later: ConversationMessage = { id: "r2", role: "assistant", text: "Captain, done: the directions button below the map is live.", timestamp: "2026-10-11T14:00:00Z", shots: ["t99.0"] };
    expect(followUps(exchanges, [handled, later])[`note:${NOTE}`]).toMatchObject({ id: "r2" });
    expect(followUps(exchanges, [handled, later])[`note:${NOTE}`]!.shots).toBeUndefined();
  });

  it("leads the outcome under his message, and a formal reply too", () => {
    const question: ConversationMessage = { id: `note:${NOTE}`, role: "user", text: "put get directions button below the map", timestamp: "2026-10-11T13:00:32Z" };
    const chat: ConversationMessage = { id: "r1", role: "assistant", text: "Sir, Get directions now sits below the map.", timestamp: "2026-10-11T13:02:04Z", answers: question.id, shots: ["/flyd/shot.png"] };
    const [inline] = inlineOutcomes(withFollowUps([{ question, waiting: "" }], { [question.id]: chat }));
    expect(inline!.question.shots).toEqual(["/flyd/shot.png"]);
    expect(inline!.settled).toBe(true);

    const formal: ConversationMessage = { id: `note-reply:${NOTE}`, role: "assistant", text: "Moved.", timestamp: "2026-10-11T13:05:00Z", answers: question.id };
    const [kept] = withFollowUps([{ question, answer: formal, waiting: "" }], { [question.id]: chat });
    expect(kept!.answer).toMatchObject({ id: formal.id, shots: ["/flyd/shot.png"] });
  });
});

describe("ReplyShots", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reply-shots-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies a shot once and finds the copy again", () => {
    const shots = new ReplyShots({ root: join(dir, "shots") });
    let reads = 0;
    const read = () => (reads++, { mediaType: "image/png", data: png(10, 10) });
    const path = shots.keep("s1", "t42.0", read)!;
    expect(path).toBe(join(dir, "shots", "s1-t42.0.png"));
    expect(readFileSync(path).equals(png(10, 10))).toBe(true);
    expect(new ReplyShots({ root: join(dir, "shots") }).keep("s1", "t42.0", read)).toBe(path);
    expect(reads).toBe(1);
    expect(shots.keep("s1", "t43.0", () => null)).toBeNull();
    expect(shots.keep("../s1", "t42.0", read)).toBeNull();
  });

  it("knows his own image by its size, as shown or scaled down", () => {
    expect(imageSize(png(856, 454))).toEqual({ width: 856, height: 454 });
    expect(isHisImage(png(856, 454), [png(856, 454, 1)])).toBe(true);
    expect(isHisImage(png(2000, 1488), [png(2242, 1668)])).toBe(true);
    expect(isHisImage(png(1440, 900), [png(2880, 1800)])).toBe(false);
    expect(isHisImage(png(856, 454), [])).toBe(false);
  });

  it("keeps the shot behind a note's answer in Flyd's storage, never his own image", async () => {
    const home = join(dir, "fm");
    const project = join(dir, "project");
    for (const sub of ["state/inbox/handled", "data/inbox-images", "bin"]) mkdirSync(join(home, sub), { recursive: true });
    mkdirSync(project);
    writeFileSync(join(home, "bin", "fm-inbox.sh"), "#!/bin/sh\n");
    const note = (id: string, body: string) =>
      writeFileSync(join(home, "state", "inbox", "handled", `${id}.note`), `id=${id}\nat=2026-10-11T13:00:32Z\nsource=text\n--\n${body}\n`);
    const OWN = "1791725531-BKsElu";
    writeFileSync(join(home, "data", "inbox-images", "1791725531564-35c10bb6.png"), png(856, 454));
    note(NOTE, "put get directions button below the map");
    note(OWN, `a lot of these could better be explained in a simple screenshot\n\n[image: ${join(home, "data", "inbox-images", "1791725531564-35c10bb6.png")}]`);
    const { text } = fold([
      injection("firstmate watcher wake"),
      takeNote(),
      ...readImage(SHOT, png(1067, 500)),
      assistantText("Captain, Get directions now sits below the map on Find us."),
      injection("firstmate watcher wake"),
      takeNote(OWN),
      ...readImage("/tmp/scratchpad/ss.png", png(856, 454)),
      assistantText("Captain, agreed. A worker is making Flyd show screenshots under replies."),
    ]);
    writeFileSync(join(project, "s1.jsonl"), text);
    const root = join(dir, "shots");
    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox: new FirstmateInbox({ home }), shots: new ReplyShots({ root }) });
    const snapshot = await source.read("s1");
    expect(snapshot.followUps?.[`note:${NOTE}`]?.shots).toEqual([expect.stringMatching(/s1-t\d+\.0\.png$/)]);
    expect(snapshot.followUps?.[`note:${OWN}`]?.shots).toBeUndefined();
    expect(readdirSync(root)).toHaveLength(1);
    expect(snapshot.messages.find((message) => message.id === `note:${NOTE}`)?.shots).toEqual(snapshot.followUps?.[`note:${NOTE}`]?.shots);
  });
});
