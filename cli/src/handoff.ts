import type { HandoffReport } from "./verification-types.js";

/**
 * A handoff must answer three questions: what was produced, where it is,
 * and what it contains. File and URL locations additionally require a
 * passing artifact check for that exact location — "where it is" must be
 * a place that verifiably exists.
 */
export function validateHandoff(report: HandoffReport): string | null {
  if (!report.what || !report.what.trim()) return "Handoff missing 'what'";
  if (!report.contains || !report.contains.trim()) return "Handoff missing 'contains'";
  if (!report.where || !report.where.location || !report.where.location.trim()) {
    return "Handoff missing 'where.location'";
  }
  if (!report.verifiedAt || Number.isNaN(Date.parse(report.verifiedAt))) {
    return "Handoff missing or invalid verifiedAt";
  }

  if (report.where.kind === "file" || report.where.kind === "url") {
    const location = report.where.location;
    const matching = report.artifactChecks.find(
      (check) => check.claim.path === location || check.claim.url === location
    );
    if (!matching) {
      return `No artifact check covers handoff location "${location}"`;
    }
    if (!matching.passed) {
      const detail = matching.failures.map((f) => f.check).join(", ") || "unknown";
      return `Artifact check failed for handoff location (${detail})`;
    }
  }

  return null;
}

/** Three-line user-facing rendering of the triad. */
export function formatHandoff(report: HandoffReport): string {
  return [
    `Produced: ${report.what}`,
    `Location: ${report.where.location}`,
    `Contents: ${report.contains}`,
  ].join("\n");
}
