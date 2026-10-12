import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { learningRequest } from "../learning-service.js";
import { parseChatGPTConversation, planChatGPTImport, readChatGPTExport } from "../chatgpt-export.js";
import { runImport } from "../../commands/import.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/chatgpt-export/conversations.json");
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function home() {
  const dir = mkdtempSync(join(tmpdir(), "flyd-chatgpt-")); dirs.push(dir); vi.stubEnv("FLYD_DIR", dir);
  return dir;
}

async function run(path: string, opts: { write?: boolean; json?: boolean } = {}) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await runImport("chatgpt", path, { ...opts, json: true });
  const out = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  log.mockRestore();
  return out;
}

describe("ChatGPT export import", () => {
  it("keeps only the current branch: edits, regenerations, tool calls and hidden context are left out", () => {
    const conversations = readChatGPTExport(FIXTURE);
    const trip = conversations.find(c => c.id === "conv-trip")!;
    expect(trip.turns.map(t => [t.user, t.assistant])).toEqual([
      ["Plan a week in Portugal from this map.", "Start in Lisbon, then head north."],
      ["Book a hotel in Porto instead.", "Three Porto hotels near Ribeira."],
    ]);
    expect(trip.turns.map(t => t.messageId)).toEqual(["u1", "u2b"]);
    expect(trip.turns[0]).toMatchObject({ sessionId: "chatgpt:conv-trip",
      occurredAt: new Date(1700000100 * 1000).toISOString() });
    expect(trip.attachments).toBe(1);
    expect(conversations.find(c => c.id === "conv-empty")!.turns).toEqual([]);
  });

  it("follows the newest branch without current_node and reads voice transcripts, never custom instructions", () => {
    const upload = readChatGPTExport(FIXTURE).find(c => c.id === "conv-upload")!;
    expect(upload.turns.map(t => t.user)).toEqual(["The upload still fails on large images.", "Raise the limit to twenty megabytes."]);
    expect(JSON.stringify(upload)).not.toContain("George");
  });

  it("shortens very long messages and marks them", () => {
    const long = "x".repeat(20000);
    const conversation = parseChatGPTConversation({ id: "long", current_node: "u", mapping: {
      u: { parent: null, children: [], message: { id: "u", author: { role: "user" }, create_time: 1, content: { content_type: "text", parts: [long] } } },
    } })!;
    expect(conversation.turns[0].user).toHaveLength(12000);
    expect(conversation.turns[0].truncated).toBe(true);
  });

  it("dry-runs with counts and date range, writing nothing", async () => {
    home();
    const summary = await run(FIXTURE);
    expect(summary).toMatchObject({ conversations: 3, empty: 1, turns: 4, newTurns: 4, alreadyImported: 0,
      attachments: 1, enabled: false, written: 0,
      from: new Date(1700000100 * 1000).toISOString(), to: new Date(1710000300 * 1000).toISOString() });
    const store = new IntelligenceEventStore();
    try { expect(store.readSource("conversation.import")).toEqual([]); } finally { store.close(); }
  });

  it("writes only under the consent switch, then adds only what a newer export brings", async () => {
    const dir = home();
    expect(await run(FIXTURE, { write: true })).toMatchObject({ written: 0, error: "Conversation import is not enabled" });
    process.exitCode = undefined;
    await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "enable" });
    // Importing reads the export locally; any network call fails the test.
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network used during import"); }));
    expect(await run(FIXTURE, { write: true })).toMatchObject({ written: 4, enabled: true });
    expect(await run(FIXTURE, { write: true })).toMatchObject({ newTurns: 0, alreadyImported: 4, written: 0 });

    const newer = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const upload = newer[2].mapping;
    upload.va.children = ["n"];
    upload.n = { id: "n", parent: "va", children: [], message: { id: "n", author: { role: "user" }, create_time: 1720000000,
      content: { content_type: "text", parts: ["Thumbnails must stay under one megabyte."] }, recipient: "all" } };
    const later = join(dir, "later.json");
    writeFileSync(later, JSON.stringify(newer));
    expect(await run(later, { write: true })).toMatchObject({ turns: 5, newTurns: 1, alreadyImported: 4, written: 1 });

    const store = new IntelligenceEventStore();
    try {
      const events = store.readSource("conversation.import");
      expect(events).toHaveLength(5);
      expect(events[0].payload?.conversation).toMatchObject({ sessionId: "chatgpt:conv-trip", messageId: "u1",
        occurredAt: new Date(1700000100 * 1000).toISOString() });
      expect(store.searchConversations(["porto"]).map(e => (e.payload?.conversation as { messageId: string }).messageId)).toEqual(["u2b"]);
    } finally { store.close(); }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the emailed zip and its extracted folder the same as conversations.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-chatgpt-zip-")); dirs.push(dir);
    const folder = join(dir, "export");
    mkdirSync(folder);
    copyFileSync(FIXTURE, join(folder, "conversations.json"));
    writeFileSync(join(folder, "chat.html"), "<html></html>");
    execFileSync("zip", ["-qr", join(dir, "export.zip"), "."], { cwd: folder });
    const ids = (path: string) => readChatGPTExport(path).map(c => [c.id, c.turns.length]);
    expect(ids(join(dir, "export.zip"))).toEqual(ids(FIXTURE));
    expect(ids(folder)).toEqual(ids(FIXTURE));
    writeFileSync(join(dir, "empty.json"), "{}");
    expect(() => readChatGPTExport(join(dir, "empty.json"))).toThrow(/not a ChatGPT export/);
  });
});
