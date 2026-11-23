import { FIX_LAYERS, type FixLayer } from "../crew/fix-layers.js";
import { tasteSkillKind, type TasteProfile, type TasteRule } from "./taste.js";

// A taste correction George has made three times is one a skill file did not
// stop. Skills are text an agent has to notice; a check holds whether or not it
// reads them. So at the third repeat a rule climbs the same fix-layer ladder
// self-improvement uses (crew/self-improve.ts): the strongest layer that can
// hold it wins. A rule a built-in check covers is checked on every design round
// and a trip fails the round. A rule that could be measured but has no check yet
// goes to self-improvement as evidence, which proposes the check. A rule that is
// pure judgment stays text, and its skill shows what wrong looked like in his words.
//
// The first check is spacing, his most repeated correction: the Creative
// Director's round measures every version's laid-out page, and a Designer's
// build is held to the same on its changed pages and CSS.

/** The repeat at which a taste rule is held by a check instead of only by text. */
export const CHECK_REPEATS = 3;

/** The checks Flyd can run today, by name. */
export type TasteCheckName = "spacing" | "snapping";

export interface TasteRulePlan {
  rule: TasteRule;
  /** The strongest fix layer that can hold the rule now. */
  layer: Extract<FixLayer, "check" | "prompt">;
  /** The built-in check that holds it, when one does. */
  check?: TasteCheckName;
  /** No check holds it yet, but one could: self-improvement is asked for it. */
  proposeCheck?: boolean;
  /** For a judgment rule kept as text: what wrong looked like, in his words. */
  wrong?: string;
}

/** Words that name something a page can be measured for, not only judged. */
const MEASURABLE = /\b(?:\d+\s*(?:px|rem|em|%)|padding|margins?|gaps?|gutters?|spacing|space (?:above|below|between)|width|height|max-width|font[- ]size|line[- ]height|contrast|align(?:ed|ment)?|cent(?:re|er)(?:d|ed)?|radius|clamp(?:ed)?|overflow|wrap|truncat\w*|letter[- ]spacing|tracking|columns?|grid)\b/i;

/** The ladder's own order: a check beats every other layer, a prompt is last. */
const STRONGER = (a: FixLayer, b: FixLayer) => FIX_LAYERS.indexOf(a) - FIX_LAYERS.indexOf(b);

/** Where each of his thrice-repeated rules sits on the ladder; rules seen fewer times are not planned. */
export function tasteCheckPlan(profile: TasteProfile): TasteRulePlan[] {
  return profile.rules
    .filter((rule) => !rule.principle && rule.count >= CHECK_REPEATS && rule.skill !== "none")
    .map((rule): TasteRulePlan => {
      const layers: FixLayer[] = ["prompt"];
      const check = /\bsnapp?\w*/i.test(rule.text) && /\b(?:grid|guide)\w*/i.test(rule.text) && /\b(?:pen|pencil|draw\w*|path|bezier)\b/i.test(rule.text)
        ? "snapping" : tasteSkillKind(rule) === "spacing" ? "spacing" : undefined;
      if (check) layers.push("check");
      const layer = layers.sort(STRONGER)[0] as "check" | "prompt";
      if (layer === "check") return { rule, layer, check };
      const wrong = rule.evidence[0]?.quote.replace(/\s+/g, " ").trim();
      return { rule, layer, ...(MEASURABLE.test(rule.text) ? { proposeCheck: true } : {}), ...(wrong ? { wrong } : {}) };
    });
}

/** The built-in checks his taste has armed: each held by at least one thrice-repeated rule. */
export function armedTasteChecks(profile: TasteProfile): Array<{ check: TasteCheckName; rules: TasteRule[] }> {
  const plans = tasteCheckPlan(profile);
  return (["spacing", "snapping"] as const).flatMap((check) => {
    const rules = plans.filter((plan) => plan.check === check).map((plan) => plan.rule);
    return rules.length ? [{ check, rules }] : [];
  });
}

/** Inspect drawing-tool source for snapping and a modifier to bypass it. */
export function snappingTrips(source: string): SpacingTrip[] {
  if (!/\b(?:pen|pencil|bezier|draw(?:ing)?)[\s_-]*tool\b/i.test(source)) return [];
  const snap = /\bsnap\w*\s*\(|Math\.round\([^)]*\/[^)]*(?:grid|step)/i.test(source);
  const targets = /\b(?:grid|guides?)\w*/i.test(source);
  const modifier = /\b(?:alt|shift|meta|ctrl)Key\b|\bkey\s*===?\s*["'](?:Alt|Shift|Meta|Control)["']/.test(source);
  if (snap && targets && modifier) return [];
  return [{ line: "Drawing tools must snap to grid points, guides and existing points, with a modifier key to disable snapping." }];
}

export function snappingCritique(trips: SpacingTrip[]): string {
  return ["Snapping check failed (this round cannot pass until it holds):", ...trips.map((trip) => `- ${trip.line}`)].join("\n");
}

// ---------------------------------------------------------------------------
// The spacing check.

/** A laid-out page, measured in a headless browser at one viewport (CSS pixels). */
export interface SpacingMetrics {
  viewport: { width: number; height: number };
  /** The whole page's height. */
  pageHeight: number;
  /** Where the visible content starts and ends, top to bottom. */
  content: { top: number; bottom: number } | null;
  /** Visible lines of text: their boxes. */
  text: Array<{ left: number; right: number; top: number; label: string }>;
  /** Each heading followed by actions (buttons, button-like links), and the gap from the last text above them. */
  headingActions: Array<{ heading: string; fontSize: number; gap: number }>;
}

export interface SpacingTrip {
  /** Plain words for the critique, said like a correction he would make. */
  line: string;
}

/** Text closer to the viewport's edge than this has no room to breathe. */
const EDGE = 8;

/** The most a heading may sit above its actions, CSS pixels, before the gap reads as a hole. */
function headingGapLimit(viewport: { width: number }, fontSize: number): number {
  return Math.max(viewport.width < 500 ? 96 : 128, Math.round(fontSize * 2.5));
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
}

/** What the spacing check finds wrong with one measured page; empty when it holds. */
export function spacingTrips(metrics: SpacingMetrics): SpacingTrip[] {
  const trips: SpacingTrip[] = [];
  const { width, height } = metrics.viewport;
  const where = width < 500 ? "on the phone" : "on desktop";
  const cramped = metrics.text.filter((line) => line.left < EDGE || line.right > width - EDGE || line.top < EDGE);
  if (cramped.length) {
    trips.push({ line: `Text touches the edge of the screen ${where} with no room to breathe ("${clip(cramped[0]!.label)}"${cramped.length > 1 ? ` and ${cramped.length - 1} more` : ""}); give it padding.` });
  }
  for (const pair of metrics.headingActions) {
    const limit = headingGapLimit(metrics.viewport, pair.fontSize);
    if (pair.gap > limit) {
      trips.push({ line: `There's a massive gap (${Math.round(pair.gap)}px) between the headline "${clip(pair.heading)}" and its buttons ${where}; close it to ${limit}px or less.` });
    }
  }
  // A page shorter than the screen is centred in it, not clamped up at the top.
  if (metrics.content && metrics.pageHeight <= height * 1.05) {
    const used = metrics.content.bottom - metrics.content.top;
    const above = metrics.content.top;
    const below = height - metrics.content.bottom;
    if (used < height * 0.6 && above < height * 0.15 && below > above * 3) {
      trips.push({ line: `It's all clamped up at the top of the page ${where} instead of sitting in the middle; centre it vertically.` });
    }
  }
  return trips;
}

/** Spacing values in added CSS lines; a gap this big between stacked elements reads as a hole. */
const MASSIVE_GAP_PX = 160;
const SPACING_DECL = /^\+(?!\+\+)\s*(margin|gap|row-gap|margin-(?:top|bottom|block|block-start|block-end))\s*:\s*([^;]+)/i;

function verticalTokens(property: string, value: string): string[] {
  const tokens = value.trim().split(/\s+/);
  if (property === "margin") return [tokens[0], tokens[2]].filter((token): token is string => Boolean(token));
  if (property === "gap") return tokens.slice(0, 1);
  return tokens;
}

/** The spacing check on a build's diff of CSS: added spacing that would leave a massive gap. */
export function cssSpacingTrips(diff: string): SpacingTrip[] {
  const trips: SpacingTrip[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { file = header[1]!; continue; }
    if (!/\.(?:css|scss|sass|less|pcss)$/i.test(file) && !/\.(?:html?|vue|svelte|astro)$/i.test(file)) continue;
    const declaration = SPACING_DECL.exec(line);
    if (!declaration) continue;
    const values = verticalTokens(declaration[1]!.toLowerCase(), declaration[2]!).flatMap((token) => [...token.matchAll(/(-?\d*\.?\d+)(px|rem|em)\b/gi)]).map(([, amount, unit]) => Number(amount) * (unit!.toLowerCase() === "px" ? 1 : 16));
    const biggest = Math.max(0, ...values);
    if (biggest >= MASSIVE_GAP_PX) {
      trips.push({ line: `${file} adds a massive ${Math.round(biggest)}px gap ("${clip(line.slice(1))}"); layouts should breathe, not leave holes. Bring it under ${MASSIVE_GAP_PX}px.` });
    }
  }
  return trips;
}

/** The trips as one block for the Creative Director's critique; the round fails on any. */
export function spacingCritique(trips: SpacingTrip[]): string {
  return ["Spacing check failed (George's most repeated correction; this round cannot pass until it holds):", ...trips.map((trip) => `- ${trip.line}`)].join("\n");
}

/**
 * The script a headless browser runs inside the measured page's frame: it reads the
 * laid-out boxes and writes SpacingMetrics, base64 JSON, into the outer page's title.
 */
export const SPACING_MEASURE_SCRIPT = `function flydMeasure(win) {
  var d = win.document, vw = win.innerWidth, vh = win.innerHeight;
  function visible(el) { var s = win.getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function reachable(el, r) {
    if (r.right <= 0 || r.left >= vw) return false;
    for (var a = el; a && a !== d.body && a !== d.documentElement; a = a.parentElement) {
      var s = win.getComputedStyle(a);
      if (s.overflowX === "visible") continue;
      var b = a.getBoundingClientRect();
      if (r.left < b.left - 1 || r.right > b.right + 1) return false;
    }
    return true;
  }
  var text = [], top = Infinity, bottom = -Infinity;
  var walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.nodeValue.trim() || !node.parentElement || !visible(node.parentElement)) continue;
    var range = d.createRange(); range.selectNodeContents(node);
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i]; if (r.width < 1 || r.height < 1 || !reachable(node.parentElement, r)) continue;
      var y = r.top + win.scrollY;
      text.push({ left: r.left, right: r.right, top: y, label: node.nodeValue.trim().slice(0, 60) });
      top = Math.min(top, y); bottom = Math.max(bottom, y + r.height);
    }
  }
  var media = d.querySelectorAll("img,svg,video,canvas,button,input");
  for (var m = 0; m < media.length; m++) { if (!visible(media[m])) continue; var b = media[m].getBoundingClientRect(); top = Math.min(top, b.top + win.scrollY); bottom = Math.max(bottom, b.bottom + win.scrollY); }
  var actionSel = "button,input[type=submit],input[type=button],a[role=button],a[class*=btn],a[class*=button],a[class*=cta]";
  var blockSel = "p,li,h1,h2,h3,h4,h5,h6,blockquote,figure,img,form,table,label,input,textarea,select";
  var all = Array.prototype.slice.call(d.body.querySelectorAll("*"));
  var pairs = [];
  var headings = d.querySelectorAll("h1,h2,h3");
  for (var h = 0; h < headings.length; h++) {
    var heading = headings[h]; if (!visible(heading)) continue;
    var start = all.indexOf(heading), last = heading.getBoundingClientRect().bottom, action = null;
    for (var k = start + 1; k < all.length; k++) {
      var el = all[k]; if (heading.contains(el)) continue;
      if (/^H[1-3]$/.test(el.tagName)) break;
      if (!visible(el)) continue;
      if (el.matches(actionSel)) { action = el; break; }
      if (el.matches(blockSel) && !el.querySelector(actionSel)) last = Math.max(last, el.getBoundingClientRect().bottom);
    }
    if (!action) continue;
    var gap = action.getBoundingClientRect().top - last;
    if (gap > 0) pairs.push({ heading: (heading.textContent || "").trim().slice(0, 60), fontSize: parseFloat(win.getComputedStyle(heading).fontSize) || 16, gap: gap });
  }
  var height = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight);
  return { viewport: { width: vw, height: vh }, pageHeight: height, content: top < bottom ? { top: top, bottom: bottom } : null, text: text.slice(0, 400), headingActions: pairs };
}`;
