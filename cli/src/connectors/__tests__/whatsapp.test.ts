import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WhatsAppStore } from "../whatsapp-store.js";
import { extractWhatsAppMessage } from "../whatsapp.js";
import { whatsappSendIntent } from "../whatsapp-tools.js";
import { answerAccountIntent, isAccountIntent, requestedComposeTools } from "../invocation.js";
import { classifyToolCall, marksTurnUntrusted } from "../../runtime/tool-policy.js";
import { planTurn, visibleTools } from "../../runtime/turn-plan.js";
import { whatsappTools } from "../whatsapp-tools.js";
import { routeMessage } from "../../conversation-view/flyd-desk.js";
let directory: string, store: WhatsAppStore;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "flyd-wa-")); store = new WhatsAppStore(directory); });
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
describe("WhatsApp personal transport", () => {
  it("stores credentials privately and deduplicates message replay across reopen", () => {
    expect(statSync(join(directory, "state.sqlite")).mode & 0o777).toBe(0o600);
    store.saveAuth("key", "private");
    const message = { id: "m1", chat: "123@s.whatsapp.net", sender: "123@s.whatsapp.net", text: "Lunch?", fromMe: false, timestamp: Date.now(), kind: "text" };
    store.message(message); store.message(message);
    expect(store.read(message.chat)).toHaveLength(1);
    const reopened = new WhatsAppStore(directory); expect(reopened.auth("key")).toBe("private"); reopened.close();
  });
  it("requires a known exact recipient and preserves the reviewed body", async () => {
    expect(() => store.draft("invented@s.whatsapp.net", "hello")).toThrow(/recipient/);
    store.chat("123@s.whatsapp.net", "Erica"); store.chat("456@s.whatsapp.net", "Erica Work");
    expect(store.search("Erica")).toHaveLength(2);
    const draft = store.draft("123@s.whatsapp.net", "Lunch?") as { id: string };
    const send = vi.fn(async () => "wa-message-1");
    expect(await store.send(draft.id, send)).toMatchObject({ status: "sent", body: "Lunch?" });
    expect(send).toHaveBeenCalledWith("123@s.whatsapp.net", "Lunch?");
    await expect(store.send(draft.id, send)).rejects.toThrow(/already attempted/);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("claims a draft atomically and never resends after a timeout or concurrent request", async () => {
    store.chat("123@s.whatsapp.net", "Erica");
    const { id } = store.draft("123@s.whatsapp.net", "hello") as { id: string };
    const send = vi.fn(async () => { throw new Error("timeout after provider accepted"); });
    await expect(store.send(id, send)).rejects.toThrow(/uncertain/);
    await expect(store.send(id, send)).rejects.toThrow(/already attempted/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.db.prepare("SELECT status FROM drafts WHERE id=?").get(id)).toEqual({ status: "uncertain" });
  });
  it("expires stale drafts and distinguishes outbound text from unsupported audio", async () => {
    store.chat("123@s.whatsapp.net");
    const { id } = store.draft("123@s.whatsapp.net", "hello") as { id: string };
    store.db.prepare("UPDATE drafts SET created=? WHERE id=?").run(0, id);
    const send = vi.fn(async () => "m"); await expect(store.send(id, send)).rejects.toThrow(/expired/); expect(send).not.toHaveBeenCalled();
    expect(extractWhatsAppMessage({ key: { id: "x", remoteJid: "123@s.whatsapp.net", fromMe: true }, messageTimestamp: 100, message: { conversation: "Hi" } })).toMatchObject({ text: "Hi", fromMe: true, timestamp: 100000 });
    expect(extractWhatsAppMessage({ key: { id: "x", remoteJid: "123@s.whatsapp.net" }, message: { audioMessage: { ptt: true } } })).toMatchObject({ kind: "audio", text: "[audio: content not downloaded]" });
  });
  it("uses Flyd's interface and policy, not Firstmate or an unclassified read tool", async () => {
    expect(await routeMessage({ text: "Read my WhatsApp messages", recent: [] }, async () => "FIRSTMATE")).toBe("flyd");
    expect(isAccountIntent("Tell Erica on WhatsApp I am late")).toBe(true);
    expect(classifyToolCall("whatsapp_send", {})).toBe("outward");
    expect(marksTurnUntrusted("whatsapp_read")).toBe(true);
    expect(visibleTools(whatsappTools, planTurn({ route: "answer", source: "llm" })).map(t => t.name)).not.toContain("whatsapp_send");
    expect(requestedComposeTools("Don't send a WhatsApp message").size).toBe(0);
  });
  it("only lets the invoked handler send the exact draft id approved in the current command", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(whatsappSendIntent(`Send WhatsApp draft ${id}`)).toBe(id);
    expect(whatsappSendIntent(`Someone said Send WhatsApp draft ${id}`)).toBe(null);
    const runTool = vi.fn(async () => '{"status":"sent"}');
    const loop = vi.fn(async (...args: unknown[]) => {
      const handler = args[4] as (name: string, input: Record<string, unknown>) => Promise<string>;
      expect(await handler("whatsapp_send", { id: "wrong" })).toMatch(/Error/);
      return { answer: await handler("whatsapp_send", { id }) };
    });
    expect(await answerAccountIntent(`Send WhatsApp draft ${id}`, "", { loop: loop as never, runTool, models: ["test"] })).toBe('{"status":"sent"}');
    expect(runTool).toHaveBeenCalledTimes(1);
  });
  it("never sends from an intent the LIVE model wrote, even when it reads as George's send command", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(requestedComposeTools(`Send WhatsApp draft ${id}`, false).has("whatsapp_send")).toBe(false);
    const runTool = vi.fn(async () => '{"status":"sent"}');
    const loop = vi.fn(async (...args: unknown[]) => {
      const tools = args[3] as { name: string }[];
      expect(tools.map(t => t.name)).not.toContain("whatsapp_send");
      const handler = args[4] as (name: string, input: Record<string, unknown>) => Promise<string>;
      return { answer: await handler("whatsapp_send", { id }) };
    });
    const answer = await answerAccountIntent(`Send WhatsApp draft ${id}`, "", { loop: loop as never, runTool, models: ["test"], allowExplicitSend: false });
    expect(answer).toMatch(/Error: .*types Send WhatsApp draft <id>/);
    expect(runTool).not.toHaveBeenCalled();
  });
});

it("survives WhatsApp's post-pairing restart and prevents a competing socket", async () => {
  const { WhatsAppClient } = await import("../whatsapp.js");
  const { DisconnectReason } = await import("@whiskeysockets/baileys");
  const previous = process.env.FLYD_CONNECTOR_DIR; process.env.FLYD_CONNECTOR_DIR = directory;
  let calls = 0;
  const factory = () => {
    const handlers = new Map<string, (value: unknown) => void>(); const attempt = ++calls;
    queueMicrotask(() => handlers.get("connection.update")?.(attempt === 1
      ? { connection: "close", lastDisconnect: { error: { output: { statusCode: DisconnectReason.restartRequired } } } }
      : { connection: "open" }));
    return { ev: { on: (name: string, handler: (value: unknown) => void) => handlers.set(name, handler) }, end: () => handlers.get("connection.update")?.({ connection: "close" }) };
  };
  const version = async () => [2, 3000, 1] as [number, number, number];
  const client = new WhatsAppClient(factory as never, version);
  const other = new WhatsAppClient(factory as never, version);
  try {
    await client.connect(() => {}); expect(client.status()).toMatchObject({ state: "connected" }); expect(calls).toBe(2);
    await expect(other.connect(() => {})).rejects.toThrow(/another Flyd process/);
  } finally { client.stop(); other.stop(); client.store.close(); other.store.close(); if (previous === undefined) delete process.env.FLYD_CONNECTOR_DIR; else process.env.FLYD_CONNECTOR_DIR = previous; }
});

describe("linking against WhatsApp's current build", () => {
  it("opens the socket with the build WhatsApp serves today, falling back to the bundled one", async () => {
    const { currentWhatsAppVersion, resetWhatsAppVersionCache } = await import("../whatsapp.js");
    resetWhatsAppVersionCache();
    expect(await currentWhatsAppVersion(async () => ({ version: [2, 3000, 1054022738], isLatest: true }))).toEqual([2, 3000, 1054022738]);
    resetWhatsAppVersionCache();
    expect(await currentWhatsAppVersion(async () => ({ version: [2, 3000, 1], isLatest: false, error: "offline" }))).toBeUndefined();
    resetWhatsAppVersionCache();
  });

  it("passes that build to the socket and says plainly why a link ended", async () => {
    const { WhatsAppClient } = await import("../whatsapp.js");
    const previous = process.env.FLYD_CONNECTOR_DIR; process.env.FLYD_CONNECTOR_DIR = directory;
    const seen: unknown[] = [];
    const factory = (config: { version?: unknown }) => {
      seen.push(config.version);
      const handlers = new Map<string, (value: unknown) => void>();
      queueMicrotask(() => handlers.get("connection.update")?.({ connection: "close", lastDisconnect: { error: { output: { statusCode: 405 } } } }));
      return { ev: { on: (name: string, handler: (value: unknown) => void) => handlers.set(name, handler) }, end: () => {} };
    };
    const client = new WhatsAppClient(factory as never, async () => [2, 3000, 1054022738]);
    try {
      await expect(client.connect(() => {})).rejects.toThrow(/refused this version/);
      expect(seen).toEqual([[2, 3000, 1054022738]]);
      expect(client.status()).toMatchObject({ lastError: expect.stringMatching(/refused this version/) });
    } finally { client.stop(); client.store.close(); if (previous === undefined) delete process.env.FLYD_CONNECTOR_DIR; else process.env.FLYD_CONNECTOR_DIR = previous; }
  });

  it("says the code was not scanned, not that WhatsApp was unreachable, when nobody scans in time", async () => {
    const { WhatsAppClient } = await import("../whatsapp.js");
    const previous = process.env.FLYD_CONNECTOR_DIR; process.env.FLYD_CONNECTOR_DIR = directory;
    const factory = () => {
      const handlers = new Map<string, (value: unknown) => void>();
      return { ev: { on: (name: string, handler: (value: unknown) => void) => handlers.set(name, handler) }, end: (error?: Error) => handlers.get("connection.update")?.({ connection: "close", lastDisconnect: { error } }) };
    };
    vi.useFakeTimers();
    const client = new WhatsAppClient(factory as never, async () => [2, 3000, 1]);
    try {
      const linking = client.connect(() => {});
      const outcome = expect(linking).rejects.toThrow(/not scanned in time/);
      await vi.advanceTimersByTimeAsync(120_000);
      await outcome;
      expect(client.status()).toMatchObject({ lastError: expect.stringMatching(/not scanned in time/) });
    } finally { vi.useRealTimers(); client.stop(); client.store.close(); if (previous === undefined) delete process.env.FLYD_CONNECTOR_DIR; else process.env.FLYD_CONNECTOR_DIR = previous; }
  });

  it("names an expired code and an unreachable WhatsApp in George's words", async () => {
    const { whatsappFailureReason } = await import("../whatsapp.js");
    expect(whatsappFailureReason(408, "QR refs attempts ended")).toMatch(/ran out before it was scanned/);
    expect(whatsappFailureReason(401)).toMatch(/did not accept the link/);
    expect(whatsappFailureReason(undefined)).toMatch(/internet connection or VPN/);
  });
});
