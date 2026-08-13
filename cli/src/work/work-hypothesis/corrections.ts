import { appendCorrection, readPresentModel } from "./store.js";
import { buildPresentModelBelief } from "./engine.js";
import type { WorkHypothesis } from "./types.js";

const DEMOTE_PATTERNS: Array<{ re: RegExp; extract?: (m: RegExpMatchArray) => string | undefined }> = [
  {
    re: /don'?t treat\s+([a-z0-9._-]+)\s+as\s+(?:my\s+)?(?:primary|main)\s+work/i,
    extract: (m) => m[1],
  },
  {
    re: /(?:not|isn'?t)\s+([a-z0-9._-]+)\s*[-—,]?\s*(?:as\s+)?(?:primary|my\s+main)/i,
    extract: (m) => m[1],
  },
  {
    re: /(?:stop|quit)\s+(?:treating\s+)?([a-z0-9._-]+)\s+as\s+primary/i,
    extract: (m) => m[1],
  },
  {
    re: /(?:primary|working on)\s+is\s+([a-z0-9._-]+)\s*,?\s+not\s+([a-z0-9._-]+)/i,
    extract: (m) => m[2],
  },
];

const REAFFIRM_PATTERNS: Array<{ re: RegExp; extract: (m: RegExpMatchArray) => string | undefined }> = [
  {
    re: /(?:actually|do)\s+(?:treat\s+)?([a-z0-9._-]+)\s+as\s+(?:primary|main)/i,
    extract: (m) => m[1],
  },
  {
    re: /reaffirm\s+([a-z0-9._-]+)/i,
    extract: (m) => m[1],
  },
  // "Flyd not secondary" / "Flyd should be driving everything"
  {
    re: /\bflyd\b[\s\S]{0,80}\bnot\s+secondary\b|\bnot\s+secondary\b[\s\S]{0,40}\bflyd\b/i,
    extract: () => "flyd",
  },
  {
    re: /\bflyd\b[\s\S]{0,80}\bdriv(?:e|es|ing)\b/i,
    extract: () => "flyd",
  },
  {
    re: /\bflyd\b\s+(?:is|should\s+be)\s+(?:the\s+)?(?:primary|main|driver)\b/i,
    extract: () => "flyd",
  },
];

export interface CorrectionParse {
  kind: "demote" | "reaffirm";
  projectName: string;
}

export function parseHypothesisCorrection(text: string): CorrectionParse | null {
  for (const { re, extract } of REAFFIRM_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const name = extract(m);
      if (name) return { kind: "reaffirm", projectName: name };
    }
  }
  for (const { re, extract } of DEMOTE_PATTERNS) {
    const m = text.match(re);
    if (m && extract) {
      const name = extract(m);
      if (name) return { kind: "demote", projectName: name };
    }
  }
  return null;
}

export function formatHypothesisCorrectionReply(
  parsed: CorrectionParse,
  presentHypothesis?: string | null,
): string {
  const name = parsed.projectName;
  const head =
    parsed.kind === "reaffirm"
      ? `Recorded and persisted: ${name} drives the view — not secondary.`
      : `Recorded and persisted: ${name} demoted from primary.`;
  const body = presentHypothesis?.trim()
    ? `\n\nUpdated Present Model:\n${presentHypothesis.trim()}`
    : "";
  return `${head}${body}`;
}

/**
 * Apply a soft-durable correction. Demotions are hard until reaffirm —
 * commits on a demoted project do not reinstate primary (KTD6).
 * Reaffirm of Core home (Flyd) also stops auto-secondary demotion.
 */
export async function applyHypothesisCorrection(
  text: string,
  options: { foregroundRoot?: string; coreCwd?: string } = {},
): Promise<WorkHypothesis | null> {
  const parsed = parseHypothesisCorrection(text);
  if (!parsed) return null;

  const prior = readPresentModel();
  const matchThread = [...(prior?.primaryThreads ?? []), ...(prior?.secondaryThreads ?? [])].find(
    (t) => t.name.toLowerCase() === parsed.projectName.toLowerCase(),
  );

  appendCorrection({
    hypothesisId: prior?.id,
    kind: parsed.kind === "reaffirm" ? "reaffirm" : "demote",
    projectName: matchThread?.name ?? parsed.projectName,
    projectRoot: matchThread?.root,
    text,
  });

  return buildPresentModelBelief({
    foregroundRoot: options.foregroundRoot,
    coreCwd: options.coreCwd,
  });
}

export { enforceDemotionConstraints } from "./store.js";
