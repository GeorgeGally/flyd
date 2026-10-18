import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNREAD_AFTER_MS, UNREAD_CHASE_MS, UNREAD_GIVE_UP_MS, UnreadNoteWatcher, unreadNotes, waited } from "../note-receipts.js";
import { deliverNotification } from "../../runtime/agenda.js";
import { ESCALATE_MS, RENUDGE_MS } from "../../command/fleet-monitor.js";
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

describe("unreadNotes", () => {
  it("counts only notes firstmate has not acknowledged for longer than three minutes, oldest first", () => {
    const unread = unreadNotes([
      note("fresh", UNREAD_AFTER_MS - 1_000, "sent"),
      note("late", 10 * 60_000, "sent"),
      note("older", 64 * 60_000, "sent"),
      note("read", 30 * 60_000, "read"),
    ], NOW);
    expect(unread).toEqual({ count: 2, oldest: ago(64 * 60_000), ids: ["note:older", "note:late"] });
  });

  it("does not count a note firstmate replied to, nor a message to Flyd itself", () => {
    const ask: Exchange = { question: { id: "ask:1", role: "user", text: "hi", timestamp: ago(60 * 60_000) }, waiting: "" };
    expect(unreadNotes([note("answered", 60 * 60_000, "sent", true), ask], NOW)).toBeNull();
  });

  it("does not count a note firstmate answered in its own chat or finished with, though it never filed it", () => {
    const settled: Exchange = { ...note("chat", 60 * 60_000, "sent"), waiting: "The footer links are fixed", settled: true };
    const finished: Exchange = { ...note("finished", 60 * 60_000, "sent"), waiting: "", answered: true };
    expect(unreadNotes([settled, finished, note("unread", 60 * 60_000, "sent")], NOW)?.ids).toEqual(["note:unread"]);
  });

  it("does not count Flyd's own chase for a missed artefact as a note he sent", () => {
    const chase: Exchange = { question: { id: "note:chase", role: "user", text: "Flyd: send that as an artefact, please", timestamp: ago(60 * 60_000), receipt: "sent", flydAsked: true }, handoff: "queued", waiting: "Working on it" };
    expect(unreadNotes([note("unread", 60 * 60_000, "sent"), chase], NOW)?.ids).toEqual(["note:unread"]);
  });
});

describe("waited", () => {
  it("puts short waits in minutes, long ones in hours and days", () => {
    expect(waited(ago(64 * 60_000), NOW)).toBe("1 h 4 min");
    expect(waited(ago(4 * 60_000), NOW)).toBe("4 min");
  });

  it("puts long waits in hours and days", () => {
    expect(waited(ago(2 * 60 * 60_000), NOW)).toBe("2 h");
    expect(waited(ago(3 * 24 * 60 * 60_000), NOW)).toBe("3 days");
  });
});

describe("UnreadNoteWatcher", () => {
  it("chases and gives up on the staff chase's own cadence", () => {
    expect(UNREAD_CHASE_MS).toBe(RENUDGE_MS);
    expect(UNREAD_GIVE_UP_MS).toBe(ESCALATE_MS);
  });

  it("chases firstmate, quietly, when a note crosses into unread, and again for a newly unread one", async () => {
    let exchanges = [note("a", 5 * 60_000, "sent"), note("b", 60_000, "sent")];
    const chase = vi.fn(async (_note: string, _requestId: string) => {});
    let now = NOW;
    const watcher = new UnreadNoteWatcher(() => exchanges, chase, () => now);

    expect(await watcher.check()).toBe(true);
    expect(chase).toHaveBeenCalledWith("FLYD CHECK-IN: 1 of George's notes has sat unread in your inbox for 5 min (note:a). Take them up now and answer each as usual.", expect.stringMatching(/^flyd-unread-[0-9a-f]{16}$/));
    expect(await watcher.check()).toBe(false);

    now += 3 * 60_000;
    expect(await watcher.check()).toBe(true);
    expect(chase).toHaveBeenLastCalledWith(expect.stringContaining("2 of George's notes have sat unread in your inbox for 8 min (note:a, note:b)."), expect.any(String));

    exchanges = [note("a", 8 * 60_000, "read"), note("b", 4 * 60_000, "read")];
    expect(await watcher.check()).toBe(false);
    expect(chase).toHaveBeenCalledTimes(2);
  });

  it("keeps chasing while the notes stay unread, each chase its own note", async () => {
    const exchanges = [note("a", 5 * 60_000, "sent")];
    const ids: string[] = [];
    let now = NOW;
    const watcher = new UnreadNoteWatcher(() => exchanges, async (_note, requestId) => { ids.push(requestId); }, () => now);
    expect(await watcher.check()).toBe(true);
    now += UNREAD_CHASE_MS - 1;
    expect(await watcher.check()).toBe(false);
    now += 1;
    expect(await watcher.check()).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it("stays quiet when nothing is unread, and tries a chase that did not go through again", async () => {
    const chase = vi.fn(async () => { throw new Error("firstmate did not take Flyd's note"); });
    const quiet = new UnreadNoteWatcher(() => [note("a", 60_000, "sent")], chase, () => NOW);
    expect(await quiet.check()).toBe(false);
    const failing = new UnreadNoteWatcher(() => [note("a", 10 * 60_000, "sent")], chase, () => NOW);
    expect(await failing.check()).toBe(false);
    expect(await failing.check()).toBe(false);
    expect(chase).toHaveBeenCalledTimes(2);
  });

  it("chases the staff first, then tells George once when the chase is two days unanswered, and no more", async () => {
    let exchanges = [note("a", UNREAD_GIVE_UP_MS + 60 * 60_000, "sent")];
    const chase = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    let now = NOW;
    const watcher = new UnreadNoteWatcher(() => exchanges, chase, () => now, notify);
    // First sight of a note already two days unread: the staff is chased, not George.
    expect(await watcher.check()).toBe(true);
    expect(chase).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();

    // The grace has not passed: neither further chase nor word to George.
    now += UNREAD_CHASE_MS - 1;
    expect(await watcher.check()).toBe(false);
    expect(notify).not.toHaveBeenCalled();

    // Grace passed, still unread: George hears it once, in plain words.
    now += 1;
    expect(await watcher.check()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("sat unread for 2 days"), "blocker");
    expect(chase).toHaveBeenCalledTimes(1);

    // Nothing more, however long the note stays unread.
    now += 10 * UNREAD_CHASE_MS;
    expect(await watcher.check()).toBe(false);
    expect(chase).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);

    // Read at last: the state clears, and a fresh note starts a fresh chase.
    exchanges = [note("b", 5 * 60_000, "sent")];
    expect(await watcher.check()).toBe(true);
    expect(chase).toHaveBeenCalledTimes(2);
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
      return { sent: await deliverNotification("Flyd", message, kind), bodies };
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
