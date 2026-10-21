import { GitHubRestAdapter } from "../../evidence/adapters/github-rest.js";
import type { EvidenceItem } from "../../evidence/types.js";

/** A completion label or a staff-authored evidence list is never verification. */
export async function verifyStaffOutcome(
  evidence: string[],
  read: (locator: string) => Promise<EvidenceItem[]> = (locator) => new GitHubRestAdapter({ token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN }).read({ locator }),
): Promise<{ status: "verified" | "unknown"; evidenceRefs: string[]; summary?: string }> {
  const links = [...new Set(evidence.flatMap((value) => value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\b/g) ?? []))].slice(0, 2);
  for (const locator of links) {
    const items = await read(locator).catch(() => []);
    const merged = items.find((item) => item.locator === locator && item.backend === "github:rest"
      && item.metadata?.merged === true && typeof item.metadata.mergeCommitSha === "string"
      && /^[0-9a-f]{40}$/.test(item.metadata.mergeCommitSha));
    if (!merged) continue;
    return { status: "verified", evidenceRefs: [locator, `github-merge:${merged.metadata?.mergeCommitSha}`],
      summary: `The change is merged${merged.title ? `: ${merged.title}` : "."}` };
  }
  return { status: "unknown", evidenceRefs: [] };
}
