import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNREAD_AFTER_MS, markRead, readUnacknowledged } from "../note-receipts.js";
import { deliverNotification } from "../../runtime/agenda.js";
import type { GeorgeKind } from "../../lib/reaches-george.js";
import type { Exchange } from "../types.js";

const NOW = Date.parse("2026-10-12T04:05:00Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

function note(id: string, sentAgoMs: number, receipt: "sent" | "read", answered = false): Exchange {
  const question = { id: `note:${id}`, role: "user" as const, text: id, timestamp: ago(sentAgoMs), receipt };
  return answered
    ? { question, answer: { id: `note-reply:${id}`, role: "assistant", text: "done", answers: `note:${id}` }, waiting: "" }
    : { question, handoff: receipt === "read" ? "taken" : "queued", waiting: "Working on it" };
}

describe("read receipts", () => {
  it("counts a note as read once firstmate answered it, settled it, finished with it or is working on it, though it never filed it", () => {
    const settled: Exchange = { ...note("chat", 60 * 60_000, "sent"), waiting: "The footer links are fixed", settled: true };
    const finished: Exchange = { ...note("finished", 60 * 60_000, "sent"), waiting: "", answered: true };
    expect(readUnacknowledged(note("answered", 60 * 60_000, "sent", true))).toBe(true);
    expect(readUnacknowledged(settled)).toBe(true);
    expect(readUnacknowledged(finished)).toBe(true);
    expect(readUnacknowledged(note("picked", UNREAD_AFTER_MS + 1, "sent"), new Set(["note:picked"]))).toBe(true);
    expect(readUnacknowledged(note("unread", 60 * 60_000, "sent"))).toBe(false);
  });

  it("marks only a sent note as read", () => {
    expect(markRead(note("a", 60_000, "sent")).question.receipt).toBe("read");
    const read = note("b", 60_000, "read");
    expect(markRead(read)).toBe(read);
  });

  it("leaves chasing to the command layer: the view has no chaser of its own", async () => {
    const exported = Object.keys(await import("../note-receipts.js"));
    expect(exported.sort()).toEqual(["UNREAD_AFTER_MS", "markRead", "readUnacknowledged"]);
  });
});

describe("the notification boundary", () => {
  async function delivered(message: string, kind?: GeorgeKind): Promise<{ sent: boolean; bodies: unknown[] }> {
    const home = mkdtempSync(join(tmpdir(), "flyd-note-home-"));
    mkdirSync(join(home, ".flyd", "overlay"), { recursive: true });
    writeFileSync(join(home, ".flyd", "overlay", "auth-token"), "token\n");
    const previousHome = process.env.HOME;
    const previousPlatform = process.platform;
    process.env.HOME = home;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ delivered: 1 }) };
    }));
    try {
      return { sent: (await deliverNotification("Flyd", message, kind)) === "shown", bodies };
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(process, "platform", { value: previousPlatform, configurable: true });
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("keeps staff silence from him: unread notes are Flyd's to chase", async () => {
    expect(await delivered("2 notes you sent are still waiting; the oldest has waited 57 min.", "silence")).toEqual({ sent: false, bodies: [] });
  });

  it("leaves finished work free to reach him through the same boundary", async () => {
    const { sent, bodies } = await delivered("Dark mode is merged.");
    expect(sent).toBe(true);
    expect(bodies).toEqual([{ title: "Flyd", message: "Dark mode is merged.", kind: "deliverable" }]);
  });
});
