import type { CaptureDoc } from "./attention.js";
import { BRAIN_CAPABILITIES } from "./brain-capabilities.js";
import type { Interest } from "./interests.js";

interface GraphStats {
  entities: number;
  edges: number;
  bodyEdges: number;
  frontmatterEdges: number;
  byType: Record<string, number>;
}

interface ReviewStats {
  total: number;
  due: number;
  reviewedToday: number;
  avgStability: number;
}

interface MemorySuggestion {
  id: string;
  type: string;
  message: string;
  action: string;
}

export interface BrainStateInput {
  docs: CaptureDoc[];
  interests: Interest[];
  wikiCount: number;
  graph: GraphStats;
  review: ReviewStats;
  suggestions: MemorySuggestion[];
  now?: Date;
}

const IMPLEMENTATION_TOKENS = new Set([
  "app", "apps", "controller", "controllers", "css", "database", "file", "files",
  "html", "javascript", "model", "models", "module", "modules", "rails", "route",
  "routes", "ruby", "service", "services", "test", "tests", "tool", "tools",
  "typescript", "view", "views",
]);

export const DEFAULT_TASTE_PROFILE = {
  preferences: [
    "weird_over_practical",
    "novel_over_important",
    "deep_dives_over_breaking_news",
    "hacker_mindset_over_consumer_mindset",
  ],
  favors: [
    "internet_archaeology",
    "creative_code",
    "hardware_weirdness",
    "protocol_history",
    "obscure_media",
    "unusual_projects",
    "severe_constraints",
  ],
  avoids: [
    "generic_world_news",
    "consumer_churn",
    "incremental_improvements",
  ],
};

export function isPollutedCapture(doc: Pick<CaptureDoc, "body" | "metadata">): boolean {
  const body = doc.body.trim();
  const source = String(doc.metadata.source ?? "").toLowerCase();
  const type = String(doc.metadata.type ?? "").toLowerCase();

  if (source === "test" || type === "test") return true;
  if (/\bhello from test suite\b/i.test(body)) return true;
  if (/^test\s*:/i.test(body) && /(.)\1{24,}/s.test(body)) return true;
  if (/(.)\1{199,}/s.test(body)) return true;
  return false;
}

export function isMeaningfulInterest(interest: Interest): boolean {
  if (!interest.auto_extracted) return true;
  return !IMPLEMENTATION_TOKENS.has(interest.topic.trim().toLowerCase());
}

function parsedTime(value: string): number | null {
  if (!value) return null;
  const normalized = /Z$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : null;
}

export function assessBrainState(input: BrainStateInput) {
  const now = input.now ?? new Date();
  const usableDocs = input.docs.filter((doc) => !isPollutedCapture(doc));
  const lastCaptureTime = usableDocs
    .map((doc) => parsedTime(doc.date))
    .filter((time): time is number => time !== null)
    .sort((a, b) => b - a)[0] ?? null;
  const staleDays = lastCaptureTime === null
    ? null
    : Math.max(0, Math.floor((now.getTime() - lastCaptureTime) / 86_400_000));
  const interests = input.interests
    .filter(isMeaningfulInterest)
    .sort((a, b) => Number(a.auto_extracted) - Number(b.auto_extracted) || b.capture_count - a.capture_count);

  return {
    health: {
      rawCaptures: input.docs.length,
      usableCaptures: usableDocs.length,
      quarantinedCaptures: input.docs.length - usableDocs.length,
      wikiPages: input.wikiCount,
      lastCaptureAt: lastCaptureTime === null ? null : new Date(lastCaptureTime).toISOString(),
      staleDays,
      stale: staleDays === null || staleDays > 7,
    },
    profile: { interests, taste: DEFAULT_TASTE_PROFILE },
    knowledge: { wikiPages: input.wikiCount, graph: input.graph },
    review: input.review,
    suggestions: input.suggestions,
    capabilities: {
      manifest: Object.fromEntries(BRAIN_CAPABILITIES.map((capability) => [capability.id, {
        integration: capability.integration,
        mutatesArchive: capability.mutatesArchive,
        description: capability.description,
      }])),
    },
  };
}
