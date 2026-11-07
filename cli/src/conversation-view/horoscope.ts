import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { fetchPublicUrl } from "../runtime/url-guard.js";

// Today's horoscope for the News tab. His sign comes from FLYD_STAR_SIGN or
// USER.md; with neither there is no horoscope rather than a guessed one. The
// words are Horoscope.com's, shown with its name and a link. Never read under
// vitest.

const SIGNS = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"];
const REFRESH_MS = 3 * 60 * 60 * 1000;
const HTML_CAP = 400_000;

export interface HoroscopeReading {
  sign: string;
  /** The day the source dates it, YYYY-MM-DD. */
  day: string;
  text: string;
  source: string;
  url: string;
}

/** His sign as the profile says it ("George's star sign is Virgo."). Pure. */
export function signFromProfile(text: string): string | undefined {
  const said = /\bstar sign is (?:an? )?([A-Za-z]+)/i.exec(text)?.[1]?.toLowerCase();
  return said && SIGNS.includes(said) ? said : undefined;
}

export function horoscopeUrl(sign: string): string {
  return `https://www.horoscope.com/us/horoscopes/general/horoscope-general-daily-today.aspx?sign=${SIGNS.indexOf(sign) + 1}`;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#39;": "'", "&rsquo;": "’", "&quot;": '"', "&nbsp;": " " };

/** The reading on the page, two sentences long, or null when the page has changed shape. Pure. */
export function parseHoroscope(html: string, sign: string): HoroscopeReading | null {
  const found = /<div class="main-horoscope">[\s\S]*?<p>\s*<strong>([A-Z][a-z]{2} \d{1,2}, \d{4})<\/strong>\s*[-–—]\s*([\s\S]*?)<\/p>/.exec(html);
  if (!found) return null;
  const date = new Date(`${found[1]} 12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const text = found[2].replace(/<[^>]*>/g, "").replace(/&[#a-z0-9]+;/gi, (entity) => ENTITIES[entity] ?? " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [text];
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { sign: sign.charAt(0).toUpperCase() + sign.slice(1), day, text: sentences.slice(0, 2).map((one) => one.trim()).join(" "), source: "Horoscope.com", url: horoscopeUrl(sign) };
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetchPublicUrl(fetch, url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`horoscope ${response.status}`);
  return (await response.text()).slice(0, HTML_CAP);
}

async function signOnDisk(): Promise<string | undefined> {
  const set = process.env.FLYD_STAR_SIGN?.trim().toLowerCase();
  if (set && SIGNS.includes(set)) return set;
  try {
    return signFromProfile(await readFile(join(FLYD_DIR, "USER.md"), "utf8"));
  } catch {
    return undefined;
  }
}

/** Keeps the day's reading, refreshed in the background. */
export class HoroscopeReader {
  private latest: HoroscopeReading | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: { sign?: () => Promise<string | undefined>; fetch?: (url: string) => Promise<string> } = {}) {}

  start(): void {
    if (process.env.VITEST || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<HoroscopeReading | null> {
    const sign = await (this.options.sign ?? signOnDisk)();
    if (!sign) {
      this.latest = null;
      return null;
    }
    try {
      this.latest = parseHoroscope(await (this.options.fetch ?? fetchHtml)(horoscopeUrl(sign)), sign) ?? this.latest;
    } catch {
      // Keep the last good reading: the card says which day it is from.
    }
    return this.latest;
  }

  current(): HoroscopeReading | null {
    return this.latest;
  }
}
