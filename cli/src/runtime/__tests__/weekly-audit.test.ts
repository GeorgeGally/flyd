import { describe, expect, it } from "vitest";
import { auditDue, startWeeklyAuditIfDue } from "../weekly-audit.js";

// Local-time dates: 2026-10-26 is a Monday.
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0);

describe("the weekly audit", () => {
  it("is due from Monday 07:00 when none ran in the last six days", () => {
    expect(auditDue(at(26, 6), undefined)).toBe(false);
    expect(auditDue(at(26, 7), undefined)).toBe(true);
    expect(auditDue(at(26, 9), at(19, 7).getTime())).toBe(true);
  });

  it("does not run twice in a week, and catches up after a missed Monday", () => {
    expect(auditDue(at(27, 10), at(26, 7).getTime())).toBe(false);
    expect(auditDue(at(28, 10), at(19, 7).getTime())).toBe(true);
  });

  it("never starts a real audit under test", () => {
    expect(startWeeklyAuditIfDue({ now: at(26, 9), dir: "/nonexistent" })).toBeUndefined();
  });
});
