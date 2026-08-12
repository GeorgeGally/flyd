import { resolve } from "path";
import { appendCorrection, activeDemotions, readPresentModel, writePresentModel } from "./store.js";
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

/**
 * Apply a soft-durable correction. Demotions are hard until reaffirm —
 * commits on a demoted project do not reinstate primary (KTD6).
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

/**
 * After integrity refresh: commits on demoted projects stay secondary.
 * Does not clear demotions based on new commits alone.
 */
export function enforceDemotionConstraints(hypothesis: WorkHypothesis): WorkHypothesis {
  const demotions = new Set(activeDemotions().map((d) => d.toLowerCase()));
  if (!demotions.size) return hypothesis;

  const primary: typeof hypothesis.primaryThreads = [];
  const secondary = [...hypothesis.secondaryThreads];

  for (const t of hypothesis.primaryThreads) {
    if (demotions.has(t.name.toLowerCase())) {
      secondary.push({ ...t, demoted: true });
    } else {
      primary.push(t);
    }
  }

  const text =
    primary.length > 0
      ? `${primary.map((t) => t.name).join(" · ")} look like tonight's active threads.` +
        (demotions.size
          ? ` Demoted: ${[...demotions].map((d) => d).join(", ")}.`
          : "")
      : hypothesis.hypothesisText;

  const next: WorkHypothesis = {
    ...hypothesis,
    primaryThreads: primary,
    secondaryThreads: secondary.filter(
      (t, i, arr) => arr.findIndex((x) => resolve(x.root) === resolve(t.root)) === i,
    ),
    demotions: [...demotions],
    hypothesisText: text,
  };

  return writePresentModel(next);
}
