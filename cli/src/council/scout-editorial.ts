import type { ScoutCandidate, ScoutFeedback } from "./scout.js";

const STOP = new Set(["the", "and", "with", "from", "new", "news", "about", "that", "for", "into", "what", "this", "like"]);
function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((token) => token.length > 3 && !STOP.has(token)));
}
function overlap(a: string, b: string): number {
  const left = tokens(a), right = tokens(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((token) => right.has(token)).length;
  return common / Math.max(1, Math.min(left.size, right.size));
}

/** Explicit subject/angle feedback, not absence of a click, affects recommendations. */
export function scoutPreferenceSignal(candidate: ScoutCandidate, feedback: ScoutFeedback[]): number {
  let score = 0;
  for (const past of feedback.slice(-80)) {
    const match = Math.max(overlap(candidate.title, past.title), overlap(candidate.topic, past.topic));
    if (match < 0.33) continue;
    const polarity = past.verdict === "more" ? 1 : -1;
    const reason = past.reason;
    const strength = reason === "bad-source" ? (past.source === candidate.source ? 0.32 : 0)
      : reason === "repeat" || reason === "already-knew" ? 0.08
      : reason === "wrong-topic" ? 0.28 : 0.2;
    score += polarity * strength * match;
  }
  return Math.max(-0.6, Math.min(0.6, score));
}

function ageScore(candidate: ScoutCandidate, now: Date): number {
  if (!candidate.published) return 0;
  const published = Date.parse(candidate.published);
  if (!Number.isFinite(published)) return 0;
  const days = (now.getTime() - published) / 86_400_000;
  if (days > 30 || days < -1) return -1;
  return days <= 3 ? 0.2 : days <= 8 ? 0.1 : days <= 21 ? 0 : -0.12;
}

function spam(candidate: ScoutCandidate): boolean {
  return /^(ask hn:|help me|anyone know|who is hiring|weekly discussion|question about|how do i\b)/i.test(candidate.title)
    || /^(giveaway|sponsored post|discount code|use my referral)\b/i.test(candidate.title);
}

/** Front-page outlets: fine sources, but what they lead with is what everyone has already seen. */
const GENERAL_OUTLET_HOSTS = new Set([
  "arstechnica.com", "daringfireball.net", "theverge.com", "techcrunch.com", "techradar.com", "slashdot.org", "fastcompany.com",
  "engadget.com", "wired.com", "gizmodo.com", "cnet.com", "zdnet.com", "9to5mac.com", "macrumors.com", "businessinsider.com",
  "bloomberg.com", "reuters.com", "cnbc.com", "forbes.com", "nytimes.com", "bbc.com", "bbc.co.uk", "theguardian.com", "apnews.com",
]);

export function generalOutlet(candidate: Pick<ScoutCandidate, "url">): boolean {
  try {
    const host = new URL(candidate.url).hostname.toLowerCase().replace(/^(?:www|feeds|rss)\./, "");
    return [...GENERAL_OUTLET_HOSTS].some((outlet) => host === outlet || host.endsWith(`.${outlet}`));
  } catch { return false; }
}

/** Vocabulary of the scenes George follows (on-chain and generative art, creative coding, AI art, internet archaeology, obscure media, protocol history, odd hardware). */
const NICHE = /\b(?:ordinals?|inscriptions?|inscribed|recursive inscriptions?|on-?chain art|generative(?! ?ai\b)|gen-?art|p5\.?js|processing\.org|touchdesigner|shaders?|glsl|plotters?|pen plotter|demoscene|demo ?party|creative cod(?:e|ing)|procedural|comfyui|stable diffusion|lora|glitch art|pixel art|net art|lost media|obscure|forgotten|internet archive|wayback machine|web archive|geocities|usenet|bbs|gopher|irc|rfc|protocol history|retro ?computing|vintage computer|emulat(?:or|ion)|reverse[- ]engineer(?:ed|ing)?|teardown|die shot|oscilloscope|esp32|cyberdeck|synth(?:esizer)?s?|modular synth|eurorack|microcontroller|chiptune|bitcoin optech)\b/i;

/** Niche interest match for the shortlist order; the curator still judges each item. */
export function nicheSignal(candidate: Pick<ScoutCandidate, "title" | "summary">): number {
  return NICHE.test(`${candidate.title} ${candidate.summary}`) ? 0.18 : 0;
}

export function scoutEditorialScore(candidate: ScoutCandidate, feedback: ScoutFeedback[], now: Date): number {
  if (spam(candidate)) return -10;
  const validation = candidate.evidenceStatus === "corroborated" ? 0.35
    : candidate.evidenceStatus === "contradicted" ? -10
    : candidate.source === "Discovery" ? -10 : 0;
  const unusual = candidate.source === "Discovery" ? 0.12 : 0;
  return validation + unusual + ageScore(candidate, now)
    + (candidate.relevanceScore ?? 0.5) * 0.16
    + nicheSignal(candidate) - (generalOutlet(candidate) ? 0.18 : 0)
    + scoutPreferenceSignal(candidate, feedback);
}

/**
 * Protects a small discovery lane while preventing source saturation.
 * Does not mandate a serendipity result: the model is free to reject all.
 */
export function prepareScoutCandidates(
  input: ScoutCandidate[], feedback: ScoutFeedback[], now: Date, max = 200,
): ScoutCandidate[] {
  const viable = input.filter((item) => scoutEditorialScore(item, feedback, now) > -5);
  const scored = viable.map((item, index) => ({ item, index, score: scoutEditorialScore(item, feedback, now) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const exploratory = scored.filter((entry) => entry.item.source === "Discovery").slice(0, 3);
  const selected = new Set(exploratory.map((entry) => entry.index));
  const ordinary = scored.filter((entry) => !selected.has(entry.index)).slice(0, Math.max(0, max - exploratory.length));
  // Place discoveries among the first 20 entries; avoid a forced editorial pick.
  const items = ordinary.map((entry) => entry.item);
  exploratory.forEach((entry, index) => items.splice(Math.min(items.length, index * 7 + 2), 0, entry.item));
  return items.slice(0, max);
}
