import { createDefaultEvidenceRegistry } from "../evidence/default-registry.js";
import { EvidenceEngine } from "../evidence/evidence-engine.js";
import type { EvidenceBundle, ResearchDepth } from "../evidence/types.js";

export interface EvidenceResearchCommandOptions {
  depth?: ResearchDepth;
  json?: boolean;
}

function formatBundle(bundle: EvidenceBundle): string {
  const lines: string[] = [
    `Flyd evidence research — ${bundle.query}`,
    `depth ${bundle.plan.depth} · ${bundle.evidence.length} evidence items · ${(bundle.clusters ?? []).length} clusters · ${bundle.conflicts.length} conflicts`,
    "",
  ];
  const clusters = bundle.clusters ?? [];
  if (clusters.length > 0) {
    clusters.slice(0, 10).forEach((cluster, index) => {
      lines.push(`${index + 1}. ${cluster.label}`);
      lines.push(`   ${cluster.summary}`);
      lines.push(`   ${cluster.sourceDiversity} source types · evidence ${cluster.evidenceIds.join(", ")}`);
    });
  } else {
    bundle.evidence.slice(0, 12).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title || item.author || item.capability}`);
      lines.push(`   ${item.content.replace(/\s+/g, " ").slice(0, 300)}`);
      if (item.locator) lines.push(`   ${item.locator}`);
    });
  }
  if (bundle.conflicts.length > 0) {
    lines.push("", "Conflicts");
    bundle.conflicts.forEach((conflict) => lines.push(`- ${conflict.topic}: ${conflict.reason}`));
  }
  if (bundle.gaps.length > 0) {
    lines.push("", "Coverage gaps");
    bundle.gaps.forEach((gap) => lines.push(`- ${gap.message}`));
  }
  return lines.join("\n");
}

export async function runEvidenceResearch(query: string, options: EvidenceResearchCommandOptions = {}): Promise<EvidenceBundle> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Evidence research query cannot be empty");
  const engine = new EvidenceEngine(createDefaultEvidenceRegistry());
  const bundle = await engine.research(trimmed, options.depth ?? "default");
  console.log(options.json ? JSON.stringify(bundle, null, 2) : formatBundle(bundle));
  return bundle;
}
