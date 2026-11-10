import { describe, expect, it } from "vitest";
import cases from "../delivery.json" with { type: "json" };
import { runFor } from "../delivery-run.js";
import type { DeliveryCase } from "../delivery-scoring.js";
import { HANDLE_IT_YOURSELF, RECOVER_IT_YOURSELF, RESTATE_FOR_GEORGE, notesSentToBoss } from "../../../intelligence/executive/decision-step.js";

const all = cases as DeliveryCase[];

describe("runFor", () => {
  it("gives a case whose send-back is spent the three delivered Flyd notes the review step reads", async () => {
    const spent = all.filter((testCase) => testCase.run?.sentToBoss === true);
    expect(spent.length).toBeGreaterThan(0);
    for (const testCase of spent) {
      const run = await runFor(testCase);
      expect(notesSentToBoss(run.messages)).toEqual([HANDLE_IT_YOURSELF, RECOVER_IT_YOURSELF, RESTATE_FOR_GEORGE]);
    }
  });

  it("gives a case with no send-back no notes", async () => {
    const fresh = all.find((testCase) => testCase.surface === "notification" && testCase.run && !testCase.run.sentToBoss);
    expect(fresh).toBeDefined();
    const run = await runFor(fresh!);
    expect(run.messages).toBeUndefined();
    expect(notesSentToBoss(run.messages)).toEqual([]);
  });
});
