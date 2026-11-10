import { describe, expect, it } from "vitest";
import { plainSaid } from "../backstage.js";

describe("plainSaid", () => {
  it("tells what came of the work, not who on the staff ran it or how it was passed along", () => {
    expect(plainSaid("The worker finished: dark mode is merged.")).toBe("Dark mode is merged.");
    expect(plainSaid("the last handoff stalled")).toBe("the last step stalled");
    expect(plainSaid("The message fix is ready on branch fm/logan-codex-limit-msg. The worker pushed it and the Fact Checker signed off."))
      .toBe("The message fix is ready. The team pushed it and the team signed off.");
    expect(plainSaid("The run failed")).toBe("The work failed");
    expect(plainSaid("Ready on branch fm/x.")).toBe("Ready.");
    expect(plainSaid("The fleet is moving.")).toBe("The work is moving.");
    expect(plainSaid("The Researchers pulled three sources.")).toBe("The team pulled three sources.");
  });

  it("says what came of a pull request without its number", () => {
    expect(plainSaid("PR #412 is merged into main.")).toBe("It is merged into main.");
    expect(plainSaid("Tests pass. PR #9 has landed.")).toBe("Tests pass. It has landed.");
    expect(plainSaid("Merged PR #412.")).toBe("Merged the pull request.");
    expect(plainSaid("Refresh the PR branches")).toBe("Refresh the pull requests");
  });

  it("keeps the number when it rewords a handoff", () => {
    expect(plainSaid("Two handoffs failed.")).toBe("Two steps failed.");
  });

  it("leaves the same words alone where they mean what they ordinarily mean", () => {
    for (const said of [
      "Added offline support via a service worker.",
      "Service workers are cached offline now.",
      "Moved parsing to a worker thread.",
      "The worker pool has 4 workers.",
      "make this run faster",
      "the run loop",
      "the fleet manager",
      "The fleet of trucks is booked.",
      "The vehicle fleet page is done.",
      "Researchers find a new battery chemistry.",
      "The Creative Director at the agency loved it.",
      "Wrote the handoff spec.",
      "Fixed a crash in the branch selector.",
      "Tuned it in the branch predictor",
      "Please run the tests.",
    ]) {
      expect(plainSaid(said)).toBe(said);
    }
  });
});
