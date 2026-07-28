import { describe, expect, it } from "vitest";
import { formatHandoff, validateHandoff } from "../handoff.js";
import type { ArtifactCheckResult, HandoffReport } from "../verification-types.js";

const passingCheck = (path: string): ArtifactCheckResult => ({
  claim: { kind: "file", path, description: "report" },
  passed: true,
  failures: [],
  byteSize: 1024,
  checkedAt: new Date().toISOString(),
});

const baseReport: HandoffReport = {
  what: "Quarterly report as PDF",
  where: { kind: "file", location: "/Users/x/Documents/report.pdf" },
  contains: "Revenue summary, three charts, appendix",
  artifactChecks: [passingCheck("/Users/x/Documents/report.pdf")],
  verifiedAt: new Date().toISOString(),
};

describe("validateHandoff", () => {
  it("accepts a complete triad with a passing artifact check", () => {
    expect(validateHandoff(baseReport)).toBeNull();
  });

  it.each([
    ["what", { ...baseReport, what: "  " }],
    ["contains", { ...baseReport, contains: "" }],
    ["where.location", { ...baseReport, where: { kind: "file" as const, location: "" } }],
  ])("rejects a missing %s", (_label, report) => {
    expect(validateHandoff(report as HandoffReport)).not.toBeNull();
  });

  it("rejects file locations with no covering artifact check", () => {
    const report = { ...baseReport, artifactChecks: [passingCheck("/some/other/file.pdf")] };
    expect(validateHandoff(report)).toContain("No artifact check covers");
  });

  it("rejects file locations whose artifact check failed", () => {
    const failed: ArtifactCheckResult = {
      ...passingCheck(baseReport.where.location),
      passed: false,
      failures: [{ check: "nonzero", detail: "File is empty" }],
    };
    const report = { ...baseReport, artifactChecks: [failed] };
    expect(validateHandoff(report)).toContain("Artifact check failed");
  });

  it("does not require artifact checks for panel results", () => {
    const report: HandoffReport = {
      ...baseReport,
      where: { kind: "panel", location: "augment panel" },
      artifactChecks: [],
    };
    expect(validateHandoff(report)).toBeNull();
  });

  it("rejects an invalid verifiedAt", () => {
    expect(validateHandoff({ ...baseReport, verifiedAt: "yesterday-ish" })).not.toBeNull();
  });
});

describe("formatHandoff", () => {
  it("renders the three-line triad", () => {
    const lines = formatHandoff(baseReport).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Produced: Quarterly report as PDF");
    expect(lines[1]).toBe("Location: /Users/x/Documents/report.pdf");
    expect(lines[2]).toBe("Contents: Revenue summary, three charts, appendix");
  });
});
