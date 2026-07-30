import type { ResearchDepth } from "./types.js";

export type EvidenceNeedLevel = "none" | "recommended" | "required";

export interface ResolutionEvidenceContext {
  intent: string;
  routeKind: string;
  locators: string[];
}

export interface EvidenceNeedDecision {
  level: EvidenceNeedLevel;
  reason: string;
  confidence: number;
  query: string;
  locators: string[];
  depth?: ResearchDepth;
  manifestation?: "augment" | "compose";
}

const RESOLUTION_SYSTEM_MARKER = "Flyd's resolution engine";
const ROUTE_KIND_MARKER = "- Kind: ";
const INTENT_START = "USER INTENT: \"";
const INTENT_END = "\"\n\nRELEVANT USER GOALS:";
const CONTEXT_START = "CURRENT CONTEXT:";
const CONTEXT_END = "\n\nUSER INTENT:";

const DEEP_RESEARCH = /\b(deep research|deep dive|research dossier|full investigation|investigate thoroughly|comprehensive (research|analysis|comparison)|compare .{0,80} in detail|go deep|detailed investigation)\b/i;
const EXPLICIT_RESEARCH = /\b(search|look up|lookup|browse|check online|research|investigate|verify|fact[- ]?check|find out)\b/i;
const LIVE_TIME = /\b(latest|currently|current|right now|today|tonight|yesterday|tomorrow|this (week|month|year)|recent|newest|just released|just announced|breaking|live)\b/i;
const VOLATILE_FACT = /\b(price|pricing|cost|availability|available|in stock|release|released|release date|version|update|updated|changelog|launch|launched|announcement|announced|schedule|score|standings|weather|forecast|law|regulation|policy|rate|CEO|president|office[- ]?holder|opening hours|status|outage)\b/i;
const MARKET_OR_CHOICE = /\b(compare|comparison|versus|vs\.?|better|best|alternative|recommend|worth it|reviews?|sentiment|what do people|everyone saying|buy|purchase)\b/i;
const EXTERNAL_SOURCE = /\b(github|youtube|reddit|twitter|x\.com|hacker news|web|internet|website|rss|news)\b/i;
const DEICTIC = /\b(this|these|that|those|it|here|page|link|listing|repo|repository|video|article)\b/i;
const PERSONAL_RECALL = /\b(what am i working on|what was i working on|what do you know about me|who am i|my memories|my background|my project|resume my work|continue my work)\b/i;
const TIMELESS = /\b(define|definition|meaning of|explain the concept|what is a [a-z -]+ in general|why does [a-z -]+ happen)\b/i;
const HTTP_URL = /https?:\/\/[^\s"'<>]+/gi;
const SENSITIVE_QUERY_KEY = /(^|[-_])(token|key|signature|sig|auth|password|passwd|secret|credential|session|x-amz)([-_]|$)/i;
const TRACKING_QUERY_KEY = /^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid)$/i;

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  if (startIndex < 0) return "";
  const from = startIndex + start.length;
  const endIndex = value.indexOf(end, from);
  return (endIndex < 0 ? value.slice(from) : value.slice(from, endIndex)).trim();
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (isPrivateIpv4(host)) return true;
  if (host.includes(":")) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
  }
  return false;
}

export function sanitizeEvidenceLocator(value: string): string | null {
  const cleaned = value.replace(/[),.;!?]+$/, "");
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || isPrivateHost(url.hostname)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) return null;
      if (TRACKING_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function uniqueLocators(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const locator = sanitizeEvidenceLocator(value);
    if (!locator || seen.has(locator)) continue;
    seen.add(locator);
    result.push(locator);
  }
  return result.slice(0, 3);
}

export function parseResolutionEvidenceContext(prompt: string): ResolutionEvidenceContext | null {
  const intent = between(prompt, INTENT_START, INTENT_END);
  if (!intent) return null;

  const routeLineStart = prompt.indexOf(ROUTE_KIND_MARKER);
  const routeKind = routeLineStart >= 0
    ? prompt.slice(routeLineStart + ROUTE_KIND_MARKER.length).split("\n", 1)[0].trim()
    : "";

  const contextBlock = between(prompt, CONTEXT_START, CONTEXT_END);
  const locators = uniqueLocators([
    ...(intent.match(HTTP_URL) ?? []),
    ...(contextBlock.match(HTTP_URL) ?? []),
  ]);

  return { intent, routeKind, locators };
}

export function isResolutionSystemPrompt(system?: string): boolean {
  return Boolean(system?.includes(RESOLUTION_SYSTEM_MARKER));
}

function decision(
  level: EvidenceNeedLevel,
  reason: string,
  confidence: number,
  query: string,
  locators: string[],
  depth: ResearchDepth = "quick",
  manifestation: "augment" | "compose" = "augment",
): EvidenceNeedDecision {
  return { level, reason, confidence, query, locators, depth, manifestation };
}

export function classifyEvidenceNeed(context: ResolutionEvidenceContext): EvidenceNeedDecision {
  const intent = context.intent.trim();
  const query = intent.replace(HTTP_URL, " ").replace(/\s+/g, " ").trim() || intent;

  if (!intent || context.routeKind !== "ask_answer") {
    return decision("none", "route does not require an external answer", 1, query, []);
  }

  const deep = DEEP_RESEARCH.test(intent);
  const explicit = EXPLICIT_RESEARCH.test(intent);
  const live = LIVE_TIME.test(intent);
  const volatile = VOLATILE_FACT.test(intent);
  const choice = MARKET_OR_CHOICE.test(intent);
  const source = EXTERNAL_SOURCE.test(intent);
  const locatorRelevant = context.locators.length > 0 && (DEICTIC.test(intent) || explicit || source || deep);

  if (deep) {
    return decision(
      "required",
      "the user explicitly requested a multi-source investigation and composed research dossier",
      0.99,
      query,
      context.locators,
      "deep",
      "compose",
    );
  }

  if (locatorRelevant) {
    return decision("required", "the answer depends on the linked or currently visible external source", 0.98, query, context.locators);
  }

  if (explicit || (live && (volatile || source)) || (live && choice)) {
    return decision("required", "the user explicitly requested verification or a time-sensitive external fact", 0.95, query, context.locators);
  }

  if (PERSONAL_RECALL.test(intent) && !explicit && !source) {
    return decision("none", "personal recall should be answered from Flyd memory/current state", 0.96, query, []);
  }

  if (TIMELESS.test(intent) && !live && !volatile && !source) {
    return decision("none", "the question is stable and conceptual", 0.9, query, []);
  }

  if (live || volatile || choice || source) {
    return decision("recommended", "current external evidence would materially improve answer quality", 0.82, query, context.locators);
  }

  return decision("none", "no material current external dependency detected", 0.78, query, []);
}
