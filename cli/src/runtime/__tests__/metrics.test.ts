import { describe, expect, it } from "vitest";
import { fiveWorkingDayWindowStart } from "../metrics.js";

describe("fiveWorkingDayWindowStart", () => {
  it("uses five working days inclusive and skips the weekend", () => {
    expect(fiveWorkingDayWindowStart(new Date("2026-07-17T12:00:00+08:00")).toISOString())
      .toBe("2026-07-12T16:00:00.000Z");
    expect(fiveWorkingDayWindowStart(new Date("2026-07-20T12:00:00+08:00")).toISOString())
      .toBe("2026-07-13T16:00:00.000Z");
  });
});
