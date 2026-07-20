import type { MemoryMatchSummary } from "./types.js";

const SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
] as const;
const SIGN_PATTERN = SIGNS.join("|");

export function isHoroscopeQuestion(message: string): boolean {
  return new RegExp(
    `(?:\\b(?:my|mine)\\b.*\\b(?:horoscope|zodiac|star sign)\\b|\\bwhat (?:is |is my |star )?sign am i\\b|\\bwhat star sign am i\\b|\\bam i (?:an? )?(?:${SIGN_PATTERN})\\b)`,
    "i",
  ).test(message);
}

interface PersonalSnapshot {
  status?: string;
  fresh_until?: string | Date | null;
  payload?: unknown;
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function verifiedHoroscopeEvidence(
  snapshot: PersonalSnapshot | null,
  configuredSign: string | null,
  now = new Date(),
): MemoryMatchSummary[] {
  if (!snapshot || !configuredSign || !SIGNS.includes(configuredSign as typeof SIGNS[number])) return [];
  const freshUntil = snapshot.fresh_until ? new Date(snapshot.fresh_until) : null;
  if (snapshot.status !== "fresh" || !freshUntil || freshUntil <= now) return [];

  const payload = snapshot.payload && typeof snapshot.payload === "object"
    ? snapshot.payload as Record<string, unknown>
    : {};
  const horoscope = Array.isArray(payload.horoscopes)
    ? payload.horoscopes.find((item) => {
        if (!item || typeof item !== "object") return false;
        const content = (item as Record<string, unknown>).content;
        if (!content || typeof content !== "object") return false;
        const fields = content as Record<string, unknown>;
        return String(fields.title ?? "").toLowerCase() === configuredSign &&
          String(fields.date ?? "") === localDate(now);
      })
    : null;
  if (!horoscope || typeof horoscope !== "object") return [];

  const content = (horoscope as Record<string, unknown>).content as Record<string, unknown>;
  const description = String(content.description ?? "").trim();
  if (!description) return [];
  const title = String(content.title);
  const date = String(content.date);
  const url = String(content.url ?? "").trim();
  return [{
    id: `verified-horoscope:${configuredSign}:${date}`,
    path: url || `personal-context/${configuredSign}/${date}`,
    excerpt: `${title} horoscope for ${date}: ${description}`,
    stale: false,
    kind: "horoscope",
  }];
}
