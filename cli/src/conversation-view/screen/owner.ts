import { SCREEN_PATTERNS, screenComplete, type FilledScreen } from "./patterns.js";
import type { ScreenMeaning } from "./meaning.js";

/** The Screen team: one named layout owner, a builder and an independent checker. */
export const SCREEN_OWNER = {
  team: "Screen",
  owner: "layout",
  members: ["designer", "builder", "checker"],
  owns: "the whole screen contract: every pattern, and every screen Flyd shows",
} as const;

export interface ScreenAssignment {
  objectId: string;
  meaning: ScreenMeaning;
  subject: string;
}

/** One stage of the loop: what is done there, and the evidence it leaves behind. */
export interface ScreenStage {
  stage: "discover" | "define" | "deliver";
  does: string;
  evidence: string[];
}

/**
 * The Screen team's working loop for one meaning, adapted from the design lab to
 * an always-on product: distinct directions first, one reviewed pattern last.
 * Design time only - the runtime selects the delivered pattern, never invents one.
 */
export function screenTeamLoop(assignment: ScreenAssignment): ScreenStage[] {
  const pattern = SCREEN_PATTERNS[assignment.meaning];
  const what = `"${assignment.subject}"`;
  return [
    {
      stage: "discover",
      does: `Write two or three genuinely different ${assignment.meaning} layouts for ${what} from the current tokens and taste; keep the seed and the direction names with the review.`,
      evidence: ["directions"],
    },
    {
      stage: "define",
      does: `Render each direction at desktop and phone, hand the screenshot alone to a fresh reviewer, fix structural problems before detail, and cover the real states: empty, loading, stale, failed, blocked, needs-decision, resolved.`,
      evidence: ["desktop", "phone"],
    },
    {
      stage: "deliver",
      does: `Cut to one direction and keep the reviewed pattern ${pattern.id}; keep the exact build brief and both screenshots.`,
      evidence: [`pattern:${pattern.id}`, "desktop", "phone"],
    },
  ];
}

export interface ScreenEvidence {
  /** Directions explored in Discover. */
  directions?: number;
  desktop?: boolean;
  phone?: boolean;
  /** The pattern was checked against a fresh reviewer's screenshot, not its own author's. */
  independent?: boolean;
}

export interface ScreenReview {
  ok: boolean;
  missing: string[];
}

/**
 * The checker's gate on a delivered screen. A screen ships only when its pattern
 * is reviewed, it carries a body, it carries the action its meaning needs, and
 * both viewports were looked at by someone other than the builder.
 */
export function reviewScreen(filled: FilledScreen, evidence: ScreenEvidence = {}): ScreenReview {
  const missing: string[] = [];
  const pattern = Object.values(SCREEN_PATTERNS).find((candidate) => candidate.id === filled.pattern);
  if (!pattern) missing.push("reviewed pattern");
  else if (pattern.meaning !== filled.meaning) missing.push("pattern matches the meaning");
  const body = screenComplete(filled);
  if (!body.ok) missing.push(...body.missing);
  if (!(evidence.directions && evidence.directions >= 2)) missing.push("distinct directions");
  if (!evidence.desktop) missing.push("desktop screenshot");
  if (!evidence.phone) missing.push("phone screenshot");
  if (!evidence.independent) missing.push("independent check");
  return { ok: missing.length === 0, missing };
}
