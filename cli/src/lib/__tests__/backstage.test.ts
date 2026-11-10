import { describe, expect, it } from "vitest";
import { plainSaid } from "../backstage.js";

describe("plainSaid", () => {
  it("tells what came of the work, not who on the staff ran it or how it was passed along", () => {
    expect(plainSaid("The worker finished: dark mode is merged.")).toBe("Dark mode is merged.");
    expect(plainSaid("the last handoff stalled")).toBe("the last step stalled");
    expect(plainSaid("The message fix is ready on branch fm/logan-codex-limit-msg. The worker pushed it and the Fact Checker signed off."))
      .toBe("The message fix is ready. The team pushed it and the team signed off.");
    expect(plainSaid("The run failed")).toBe("The work failed");
  });

  it("leaves the same words alone where they mean what they ordinarily mean", () => {
    for (const said of ["Added offline support via a service worker.", "The vehicle fleet page is done.", "Wrote the handoff spec.", "Please run the tests."]) {
      expect(plainSaid(said)).toBe(said);
    }
  });
});
