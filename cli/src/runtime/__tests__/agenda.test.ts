import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAgendaItem, agendaPaths, cancelAgendaItem, markInboxRead, nextOccurrence, parseLocalDateTime,
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
});
