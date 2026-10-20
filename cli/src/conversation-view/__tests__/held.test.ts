import { describe, expect, it } from "vitest";
import { attentionHeld, HeldOutcomes } from "../held.js";

describe("attentionHeld", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

  it("keeps the newest report of the same work, so one after his choice comes back to him", () => {
    const outcomes = new HeldOutcomes();
    const first = { label: "Deploy site", task: "a", repo: "site", status: "failed", at: at(3) };
    outcomes.record([first], "act", now - 2 * 3_600_000);
    const again = { label: "Deploy site", task: "b", repo: "site", status: "failed", at: at(1) };
    const paused = { label: "Other work", task: "c", status: "paused", at: at(2) };
    expect(attentionHeld([first, paused, again], (row) => outcomes.handled(row), now).map((row) => row.task)).toEqual(["b", "c"]);
  });

  it("represents repeated work by its newest copy and hides it while that copy is older than his choice", () => {
    const outcomes = new HeldOutcomes();
    const older = { label: "Deploy site", task: "a", repo: "site", at: at(5) };
    const newer = { label: "Deploy site", task: "b", repo: "site", at: at(4) };
    expect(attentionHeld([older, newer], () => false, now).map((row) => row.task)).toEqual(["b"]);
    outcomes.record([newer, older], "dismiss", now);
    expect(attentionHeld([older, newer], (row) => outcomes.handled(row), now)).toEqual([]);
  });

  it("shows work redispatched under the same name before it has reported, but not the copies he already saw", () => {
    const outcomes = new HeldOutcomes();
    const first = { label: "Deploy site", task: "a", repo: "site", status: "failed", at: at(3) };
    const copy = { label: "Deploy site", task: "a-copy", repo: "site", status: "no word" };
    outcomes.record([first, copy], "act", now - 2 * 3_600_000);
    expect(attentionHeld([first, copy], (row) => outcomes.handled(row), now)).toEqual([]);
    const redispatched = { label: "Deploy site", task: "b", repo: "site", status: "failed" };
    expect(attentionHeld([first, copy, redispatched], (row) => outcomes.handled(row), now).map((row) => row.task)).toEqual(["b"]);
  });
});
