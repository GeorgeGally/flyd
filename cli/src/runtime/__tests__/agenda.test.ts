import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAgendaItem, agendaPaths, cancelAgendaItem, deliverNotification, markInboxRead, nextOccurrence, parseLocalDateTime,
  readAgenda, runDueAgenda, unreadInbox, upcomingAgenda, type AgendaPaths,
} from "../agenda.js";

describe("agenda", () => {
  let dir: string;
  let paths: AgendaPaths;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-agenda-"));
    paths = agendaPaths(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const at = (text: string) => parseLocalDateTime(text)!;

  it("computes recurrences at the same wall-clock time", () => {
    expect(nextOccurrence(at("2026-09-26 08:00"), "daily", at("2026-09-26 09:00"))).toEqual(at("2026-09-27 08:00"));
    // Friday → Monday for weekdays.
    expect(nextOccurrence(at("2026-09-25 08:00"), "weekdays", at("2026-09-25 09:00"))).toEqual(at("2026-09-28 08:00"));
    expect(nextOccurrence(at("2026-09-26 08:00"), "weekly", at("2026-09-26 09:00"))).toEqual(at("2026-10-03 08:00"));
    // Catches up past missed slots rather than firing each one.
    expect(nextOccurrence(at("2026-09-20 08:00"), "daily", at("2026-09-26 09:00"))).toEqual(at("2026-09-27 08:00"));
    expect(nextOccurrence(at("2026-09-26 08:00"), "none", at("2026-09-26 09:00"))).toBeNull();
  });

  it("adds, lists, and cancels items", () => {
    const now = at("2026-09-26 12:00");
    const item = addAgendaItem({ task: "Check if the PR merged", when: "2026-09-27 09:00" }, paths, now);
    expect(upcomingAgenda(paths).map((i) => i.id)).toEqual([item.id]);
    expect(() => addAgendaItem({ task: "x", when: "2026-09-25 09:00" }, paths, now)).toThrow("in the past");
    expect(() => addAgendaItem({ task: "x", when: "tomorrow" }, paths, now)).toThrow("YYYY-MM-DD HH:MM");
    // A recurring item whose first slot passed starts at the next one.
    const daily = addAgendaItem({ task: "Morning brief", when: "2026-09-26 08:00", repeat: "daily" }, paths, now);
    expect(new Date(daily.nextRunAt)).toEqual(at("2026-09-27 08:00"));
    expect(cancelAgendaItem(item.id, paths)?.task).toBe("Check if the PR merged");
    expect(readAgenda(paths).map((i) => i.id)).toEqual([daily.id]);
  });

  it("runs due items once, files results in the inbox, notifies, and reschedules repeats", async () => {
    const created = at("2026-09-26 07:00");
    const once = addAgendaItem({ task: "Check the PR", when: "2026-09-26 08:00" }, paths, created);
    const daily = addAgendaItem({ task: "Morning brief", when: "2026-09-26 08:00", repeat: "daily" }, paths, created);
    addAgendaItem({ task: "Later", when: "2026-09-26 18:00" }, paths, created);
    const notify = vi.fn(async () => {});
    const runTask = vi.fn(async (task: string) => task === "Check the PR" ? "Merged." : "3 things today.");

    const result = await runDueAgenda({ paths, now: () => at("2026-09-26 08:05"), runTask, notify });
    expect(result.ran.map((r) => r.task).sort()).toEqual(["Check the PR", "Morning brief"]);
    expect(notify).toHaveBeenCalledTimes(2);
    const items = readAgenda(paths);
    expect(items.find((i) => i.id === once.id)?.enabled).toBe(false);
    expect(new Date(items.find((i) => i.id === daily.id)!.nextRunAt)).toEqual(at("2026-09-27 08:00"));
    expect(unreadInbox(paths).map((e) => e.result).sort()).toEqual(["3 things today.", "Merged."]);

    // Nothing due now → nothing runs again.
    const again = await runDueAgenda({ paths, now: () => at("2026-09-26 08:10"), runTask, notify });
    expect(again.ran).toEqual([]);
    markInboxRead(paths);
    expect(unreadInbox(paths)).toEqual([]);
  });

  it("scrubs a backstage term out of the notification title through the real boundary", async () => {
    addAgendaItem({ task: "Check the fm/island-filter branch and report", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    const home = mkdtempSync(join(tmpdir(), "flyd-agenda-home-"));
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
      await runDueAgenda({ paths, now: () => at("2026-09-26 08:05"), runTask: async () => "Dark mode is merged." });
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.title).not.toMatch(/firstmate|crew ?mates?|crewmember|Jev|Librarian|Critic|Strategist|Muse|Scout|council|task id|run id|branch|worktree|pipeline|fm\//i);
      expect(bodies[0]!.message).toBe("Dark mode is merged.");
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(process, "platform", { value: previousPlatform, configurable: true });
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("holds a notification naming backstage whole, telling him only that his call is needed when it is a decision or blocker", async () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-agenda-home-"));
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
      expect(await deliverNotification("Flyd", "FirstMate merged the crew branch. The sidebar opens on Artefacts.")).toBe("backstage");
      expect(await deliverNotification("Flyd", "Logo refresh: Firstmate will decide whether to merge the crew branch.", "deliverable", "Logo refresh")).toBe("backstage");
      expect(await deliverNotification("Logo", "Firstmate needs your call on the logo.", "decision")).toBe("shown");
      expect(await deliverNotification("Flyd", "Logo refresh: the crew branch is stuck.", "blocker", "Logo refresh")).toBe("shown");
      expect(bodies).toEqual([
        { title: "Logo", message: "I need your decision on some of your work.", kind: "decision" },
        { title: "Flyd", message: 'I need your decision on "Logo refresh".', kind: "blocker" },
      ]);
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(process, "platform", { value: previousPlatform, configurable: true });
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("notifies in one line, outcome first, never the whole answer", async () => {
    addAgendaItem({ task: "Morning briefing", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    const home = mkdtempSync(join(tmpdir(), "flyd-agenda-home-"));
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
    const answer = [
      "Sir, here's your briefing for today.",
      "",
      "**The CapFive redirects are live** and every old address lands on its new page.",
      "",
      "- Three meetings, the first at 10:00.",
      "- The Good Neighbours deploy is still in review.",
    ].join("\n");
    try {
      await runDueAgenda({ paths, now: () => at("2026-09-26 08:05"), runTask: async () => answer });
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.message).toBe("The CapFive redirects are live and every old address lands on its new page.");
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(process, "platform", { value: previousPlatform, configurable: true });
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("records a failed task instead of crashing, and skips while another runner holds the lock", async () => {
    addAgendaItem({ task: "Flaky", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    writeFileSync(paths.lock, "");
    const locked = await runDueAgenda({ paths, now: () => at("2026-09-26 08:05"), runTask: async () => "x", notify: async () => {} });
    expect(locked).toEqual({ ran: [], skipped: "locked" });
    rmSync(paths.lock);
    const result = await runDueAgenda({
      paths, now: () => at("2026-09-26 08:05"), notify: async () => {},
      runTask: async () => { throw new Error("provider down"); },
    });
    expect(result.ran[0].status).toBe("failed");
    expect(unreadInbox(paths)[0].result).toBe("Could not complete: provider down");
  });

  it("runs a failed item again once, and only then tells George plainly, without the error", async () => {
    addAgendaItem({ task: "Call the bank", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    const seen: Array<{ message: string; kind?: string }> = [];
    const notify = async (_title: string, message: string, kind?: string) => { seen.push({ message, kind }); };

    let calls = 0;
    const flaky = vi.fn(async () => { calls += 1; if (calls === 1) throw new Error("provider down"); return "Rang them; all clear."; });
    await runDueAgenda({ paths, now: () => at("2026-09-26 08:05"), runTask: flaky, notify });
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([{ message: "Rang them; all clear.", kind: "deliverable" }]);

    addAgendaItem({ task: "Second try", when: "2026-09-26 09:00" }, paths, at("2026-09-26 07:00"));
    const down = vi.fn(async () => { throw new Error("Command failed: ENOENT /tmp/x.sh"); });
    await runDueAgenda({ paths, now: () => at("2026-09-26 09:05"), runTask: down, notify });
    expect(down).toHaveBeenCalledTimes(2);
    expect(seen[1]).toEqual({ message: "\"Second try\" is blocked: I ran it again and it failed. Tell me whether to try another way or drop it.", kind: "blocker" });
    expect(seen[1]!.message).not.toMatch(/ENOENT|Command failed|\/tmp/);
  });

  it("never runs a turn again once a tool has run in it, and leaves the failure for George", async () => {
    addAgendaItem({ task: "Draft the reply", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    const seen: Array<{ message: string; kind?: string }> = [];
    const notify = async (_title: string, message: string, kind?: string) => { seen.push({ message, kind }); };
    const late = vi.fn(async (_task: string, _item: unknown, onTool: (name: string) => void) => {
      onTool("email_draft");
      throw new Error("model timed out");
    });
    const result = await runDueAgenda({ paths, now: () => at("2026-09-26 08:05"), runTask: late, notify });
    expect(late).toHaveBeenCalledTimes(1);
    expect(result.ran[0]!.status).toBe("failed");
    expect(seen).toEqual([{ message: "\"Draft the reply\" is blocked: it stopped partway, so I didn't run it twice. Tell me whether to try another way or drop it.", kind: "blocker" }]);
  });
});
