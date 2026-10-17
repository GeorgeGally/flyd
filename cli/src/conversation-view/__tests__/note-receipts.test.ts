import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNREAD_AFTER_MS, UnreadNoteWatcher, unreadNotes, unreadWarning, waited } from "../note-receipts.js";
import { deliverNotification } from "../../runtime/agenda.js";
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
});

describe("unreadWarning", () => {
  it("says how many notes firstmate has not read and how long the oldest has waited", () => {
    expect(unreadWarning({ count: 13, oldest: ago(64 * 60_000), ids: [] }, NOW)).toBe("Firstmate has not read 13 notes you sent; the oldest has waited 1 h 4 min.");
    expect(unreadWarning({ count: 1, oldest: ago(4 * 60_000), ids: [] }, NOW)).toBe("Firstmate has not read 1 note you sent 4 min ago.");
  });

  it("puts long waits in hours and days", () => {
    expect(waited(ago(2 * 60 * 60_000), NOW)).toBe("2 h");
    expect(waited(ago(3 * 24 * 60 * 60_000), NOW)).toBe("3 days");
  });
});

describe("UnreadNoteWatcher", () => {
  it("notifies once when a note crosses into unread, and again only for a newly unread one", async () => {
    let exchanges = [note("a", 5 * 60_000, "sent"), note("b", 60_000, "sent")];
    const notify = vi.fn(async () => {});
    let now = NOW;
    const watcher = new UnreadNoteWatcher(() => exchanges, notify, () => now);

    expect(await watcher.check()).toBe(true);
    expect(notify).toHaveBeenCalledWith("Flyd", "Firstmate has not read 1 note you sent 5 min ago.");
    expect(await watcher.check()).toBe(false);

    now += 3 * 60_000;
    expect(await watcher.check()).toBe(true);
    expect(notify).toHaveBeenLastCalledWith("Flyd", "Firstmate has not read 2 notes you sent; the oldest has waited 8 min.");

    exchanges = [note("a", 8 * 60_000, "read"), note("b", 4 * 60_000, "read")];
    expect(await watcher.check()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when nothing is unread and survives a failing notification", async () => {
    const notify = vi.fn(async () => { throw new Error("osascript missing"); });
    const quiet = new UnreadNoteWatcher(() => [note("a", 60_000, "sent")], notify, () => NOW);
    expect(await quiet.check()).toBe(false);
    const failing = new UnreadNoteWatcher(() => [note("a", 10 * 60_000, "sent")], notify, () => NOW);
    expect(await failing.check()).toBe(true);
  });
});

describe("the unread warning on its way to George", () => {
  it("reaches him scrubbed, through the real notification boundary, keeping the counts and the wait", async () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-note-home-"));
    mkdirSync(join(home, ".flyd", "overlay"), { recursive: true });
    writeFileSync(join(home, ".flyd", "overlay", "auth-token"), "token\n");
    const previousHome = process.env.HOME;
    const previousPlatform = process.platform;
    process.env.HOME = home;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const bodies: Array<{ title: string; message: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as { title: string; message: string });
      return { ok: true, json: async () => ({ delivered: 1 }) };
    }));
    try {
      const exchanges = [note("a", 57 * 60_000, "sent"), note("b", 5 * 60_000, "sent")];
      const watcher = new UnreadNoteWatcher(() => exchanges, deliverNotification, () => NOW);
      expect(await watcher.check()).toBe(true);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.message).not.toMatch(/firstmate|crew ?mates?|crewmember|Jev|Librarian|Critic|Strategist|Muse|Scout|council|task id|run id|branch|worktree|pipeline/i);
      expect(bodies[0]!.message).toContain("2 notes");
      expect(bodies[0]!.message).toContain("57 min");
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(process, "platform", { value: previousPlatform, configurable: true });
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
