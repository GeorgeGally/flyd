import { describe, expect, it } from "vitest";
import {
  dueStatus,
  formatDueLabel,
  formatDueNote,
  formatDueSpoken,
  isPassed,
  resolveDueYear,
} from "../due-dates.js";

/** Local noon keeps the calendar day stable on any machine time zone. */
function localNoon(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

describe("due dates", () => {
  it("treats a date that passed yesterday as history, not overdue work", () => {
    const now = localNoon(2026, 8, 15);
    expect(dueStatus("2026-09-14", now)).toEqual({ state: "passed", daysPastDue: 1 });
    expect(isPassed("2026-09-14", now)).toBe(true);
    expect(formatDueNote("2026-09-14", now)).toBe("was due 14 September");
    expect(formatDueNote("2026-09-14", now)).not.toMatch(/overdue/);
  });

  it("treats a date that passed long ago the same way, with no day count", () => {
    const now = localNoon(2026, 8, 15);
    expect(dueStatus("2026-09-05", now)).toEqual({ state: "passed", daysPastDue: 10 });
    expect(isPassed("2026-09-05", now)).toBe(true);
    expect(formatDueNote("2026-09-05", now)).toBe("was due 5 September");
  });

  it("separates today from upcoming", () => {
    const now = localNoon(2026, 8, 15);
    expect(dueStatus("2026-09-15", now)?.state).toBe("today");
    expect(isPassed("2026-09-15", now)).toBe(false);
    expect(formatDueNote("2026-09-15", now)).toBe("due today");
    expect(dueStatus("2026-09-20", now)).toEqual({ state: "upcoming", daysPastDue: -5 });
    expect(formatDueNote("2026-09-20", now)).toBe("due 20 September");
  });

  it("keeps today as today late in the evening, and yesterday as passed", () => {
    const lateEvening = new Date(2026, 8, 15, 23, 30, 0, 0);
    expect(dueStatus("2026-09-15", lateEvening)?.state).toBe("today");
    expect(dueStatus("2026-09-14", lateEvening)).toEqual({ state: "passed", daysPastDue: 1 });
  });

  it("returns no status for a missing or unparsable date", () => {
    expect(dueStatus(undefined)).toBeUndefined();
    expect(dueStatus("")).toBeUndefined();
    expect(dueStatus("not-a-date")).toBeUndefined();
    expect(isPassed(undefined)).toBe(false);
    expect(formatDueNote("not-a-date")).toBe("due not-a-date");
  });

  it("appends the year only when it differs from the current year", () => {
    const now = localNoon(2026, 8, 15);
    expect(formatDueSpoken("2026-09-05", now)).toBe("5 September");
    expect(formatDueSpoken("2027-01-02", now)).toBe("2 January 2027");
    expect(formatDueLabel("2026-09-05", now)).toBe("5 Sep");
    expect(formatDueLabel("2027-01-02", now)).toBe("2 Jan 2027");
  });

  it("keeps a missed deadline in the current year", () => {
    const now = localNoon(2026, 8, 15);
    expect(resolveDueYear(8, 5, now)).toBe(2026);
    expect(resolveDueYear(8, 13, now)).toBe(2026);
    expect(resolveDueYear(8, 20, now)).toBe(2026);
  });

  it("rolls into next year only at the year boundary", () => {
    const december = localNoon(2026, 11, 30);
    expect(resolveDueYear(0, 2, december)).toBe(2027);
    expect(resolveDueYear(11, 25, december)).toBe(2026);
  });
});
