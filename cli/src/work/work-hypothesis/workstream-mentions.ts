import { displayName } from "./candidates.js";
import { appendCorrection, projectHypothesisLine, readPresentModel } from "./store.js";
import { buildPresentModelBelief } from "./engine.js";
import type { CandidateRepoInput } from "./types.js";

export interface WorkstreamMention {
  name: string;
  alias?: string;
}

const FORGOT = /workstreams?\s+(?:u |you )?forgot\s+(.+)$/i;
const ALSO_AKA = /^(?:and |also )(.+?),\s*aka\s+([A-Za-z0-9]{2,12})\.?$/i;

export function parseWorkstreamMention(text: string): WorkstreamMention | null {
  const trimmed = text.trim();
  const forgot = trimmed.match(FORGOT);
  if (forgot?.[1]) return { name: forgot[1].trim().replace(/[.!]+$/, "") };

  const also = trimmed.match(ALSO_AKA);
  if (also?.[1]) return { name: also[1].trim(), alias: also[2]?.trim() };

  if (/\bdead internet radio\b/i.test(trimmed) && /\baka\s+dir\b/i.test(trimmed)) {
    return { name: "dead internet radio", alias: "DIR" };
  }

  return null;
}

function canonicalName(mention: WorkstreamMention): string {
  const alias = mention.alias?.toLowerCase();
  if (alias === "dir" || /dead internet radio/i.test(mention.name)) {
    return displayName("dead internet radio");
  }
  return displayName(mention.name);
}

export function alreadyListedWorkstream(name: string, streams: string[]): boolean {
  const key = name.toLowerCase();
  return streams.some((s) => {
    const n = s.toLowerCase();
    return n === key || n.includes(key) || key.includes(n);
  });
}

export async function handleWorkstreamMention(
  message: string,
  options: {
    foregroundRoot?: string;
    coreCwd?: string;
    repos?: CandidateRepoInput[];
  } = {},
): Promise<string | null> {
  const parsed = parseWorkstreamMention(message);
  if (!parsed) return null;

  const name = canonicalName(parsed);
  const prior = readPresentModel();
  const streams = prior?.insights?.workstreams ?? [];

  if (alreadyListedWorkstream(name, streams) || alreadyListedWorkstream(parsed.name, streams)) {
    return `Already in workstreams: ${streams.join(", ") || name}.`;
  }

  appendCorrection({
    hypothesisId: prior?.id,
    kind: "promote",
    projectName: name,
    text: message,
  });

  const next = await buildPresentModelBelief({
    foregroundRoot: options.foregroundRoot,
    coreCwd: options.coreCwd,
    repos: options.repos,
  });
  return `Recorded workstream ${name} (persisted).\n\n${projectHypothesisLine(next)}`;
}
