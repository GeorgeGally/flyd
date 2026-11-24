import { describe, expect, it } from "vitest";
import { workNowBrief } from "../work-now.js";

describe("what George is working on now", () => {
  it("is a short brief, one line per signal, with empty signals left out", () => {
    const brief = workNowBrief({
      projects: ["SYNTHETIC_PROJECT (plotter toolpaths)", "SYNTHETIC_PROJECT (plotter toolpaths)"],
      commits: ["SYNTHETIC_REPO: add a sand-plotter driver"],
      sessions: ["SYNTHETIC_SESSION: shader for a CRT bloom"],
      boards: [],
    });
    expect(brief).toBe([
      "Projects: SYNTHETIC_PROJECT (plotter toolpaths)",
      "Recent commits: SYNTHETIC_REPO: add a sand-plotter driver",
      "Coding sessions: SYNTHETIC_SESSION: shader for a CRT bloom",
    ].join("\n"));
  });

  it("stays small however much is going on, and says nothing when nothing is", () => {
    const many = Array.from({ length: 40 }, (_, index) => `SYNTHETIC_COMMIT_${index} ${"x".repeat(200)}`);
    const brief = workNowBrief({ commits: many, sessions: many })!;
    expect(brief.length).toBeLessThanOrEqual(1_600);
    expect(brief.split("\n")[0]!.split("; ")).toHaveLength(8);
    expect(workNowBrief({})).toBeNull();
  });
});
