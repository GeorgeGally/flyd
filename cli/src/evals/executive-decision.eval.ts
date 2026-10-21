import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadJudgmentTraces, loadReplayCases, replayPredicates } from "../cognition/system-one/replay.js";

it("replays staff judgments without any wrong high-confidence decision or false interruption", async () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/system-one");
  const report = await replayPredicates(loadReplayCases(join(dir, "executive-change.jsonl")), {
    mode: "recorded", recordings: loadJudgmentTraces(join(dir, "executive-recordings.jsonl")),
  });
  for (const predicate of report.predicates) {
    expect(predicate.unreplayable).toEqual({ missing: [], stale: [], errors: [] });
    expect(predicate.jev.wrong).toBe(0);
    expect(predicate.jev.correct).toBeGreaterThan(0);
  }
  const route = report.predicates.find((predicate) => predicate.predicateId === "executive_change_route")!;
  expect(route.rows.find((row) => row.caseId === "executive-either-or")?.jev).toBe("ask_george");
  expect(route.rows.find((row) => row.caseId === "executive-cancelled")?.jev).toBe("handle_internally");
});
