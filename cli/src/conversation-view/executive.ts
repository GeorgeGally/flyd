import { escapeHtml, renderMarkdown } from "./markdown.js";
import { capitalise, clip, inline, sentences } from "./summaries.js";

// Flyd talks to him like an executive briefing: outcomes, what they lead to
// and the one thing asked of him, in prose. Firstmate's engineering stubs (PR
// and GitHub URLs, PR numbers, branch names, commit hashes, check counts) never
// reach the screen as text; a link survives as the sentence that names the
// work, which opens it. Lists read as prose, and a reply that reports several
// pieces of work and their states shows them as a small status card instead.

const FENCED = /(```[\s\S]*?```)/g;
const URL = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"”’]/g;
const LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const GITHUB_PULL = /^https?:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/(?:pull|issues)\/(\d+)/i;
/** A link label that is itself a stub: a URL, "#83", "PR 83", "flyd#83". */
const STUB_LABEL = /^\s*(?:https?:\/\/\S+|(?:[\w.-]+\/)?[\w.-]*#\d+|(?:PR|pull request|issue)\s*#?\d+)\s*$/i;
const PR_NUMBER = /\b(?:PRs?|pull requests?)\s*#?(\d+)\b/gi;
const BRANCH = /`?\b(?:fm|feat|feature|fix|chore|codex|claude|bugfix|hotfix|release)\/[\w./-]*[\w-]`?/g;
const HASH = /`?\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b`?/g;
const COUNT_WORD = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const CHECK_COUNT = new RegExp(`\\b(?:all\\s+)?${COUNT_WORD}\\s+(?:of\\s+${COUNT_WORD}\\s+)?(?:CI\\s+)?(checks?|tests?)\\b`, "gi");
const RATIO = /\s*\(?\b(\d+)\s*\/\s*(\d+)\b\)?(?=(\s+(?:tests?|checks?|pass\w*))?)/g;

/** A placeholder for a stub that was a link: the sentence around it carries the link instead. */
const TOKEN = "⁣";

function linkLabel(url: string): string {
  const pull = GITHUB_PULL.exec(url);
  if (pull) return `${capitalise(pull[1]!.replace(/[-_]+/g, " "))} change`;
  try {
    return new globalThis.URL(url).host.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

/** One prose stretch (a sentence, or a list item) with its stub tokens gone and its first link on the words. */
function relink(stretch: string, urls: string[]): string {
  if (!stretch.includes(TOKEN)) return stretch;
  let text = stretch;
  const own: string[] = [];
  text = text.replace(new RegExp(`${TOKEN}(\\d+)${TOKEN}`, "g"), (_match, index: string) => {
    own.push(urls[Number(index)]!);
    return TOKEN;
  });
  const lead = /^(\s*(?:[-*+]|\d+[.)])\s+|\s*)/.exec(text)![1]!;
  let body = text.slice(lead.length);
  // An item that is only the link names the work by where it lives.
  if (!body.replace(new RegExp(TOKEN, "g"), "").replace(/[\s,.;:—–-]/g, "")) return `${lead}[${linkLabel(own[0]!)}](${own[0]})`;
  body = body
    .replace(new RegExp(`^${TOKEN}\\s*[,:—–-]\\s*([^,]+?),\\s+`), "$1 ")
    .replace(new RegExp(`^${TOKEN}\\s*[,:—–-]?\\s*`), "")
    .replace(new RegExp(`\\s*,\\s*${TOKEN}\\s*,`, "g"), "")
    .replace(new RegExp(`\\s*\\(\\s*${TOKEN}\\s*\\)`, "g"), "")
    .replace(new RegExp(`\\s+(?:at|on|in|as|here|see|via)\\s*:?\\s*${TOKEN}`, "gi"), "")
    .replace(new RegExp(`\\s*${TOKEN}\\s*:\\s*`, "g"), " ")
    .replace(new RegExp(`\\s*${TOKEN}`, "g"), "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*([.;:!?])/g, "$1")
    .replace(/\s+(?:and|or)\s*([.;:!?]|$)/g, "$1")
    .replace(/\b(as|at|in)\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  body = capitalise(body);
  if (!body) return lead.trimEnd();
  // A Markdown link cannot hold another; a sentence that already links keeps its own.
  if (/\]\(/.test(body)) return `${lead}${body}`;
  const end = /^(.*?)([.!?:]?)$/s.exec(body)!;
  return `${lead}[${end[1]}](${own[0]})${end[2]}`;
}

function stripProse(prose: string): string {
  const urls: string[] = [];
  const token = (url: string) => `${TOKEN}${urls.push(url) - 1}${TOKEN}`;
  let text = prose
    .replace(LINK, (match, label: string, url: string) => (STUB_LABEL.test(label) ? token(url) : match))
    // Keep links that are already on words; take the bare ones out.
    .split(/(\[[^\]]*\]\([^)]*\))/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(URL, (url) => token(url))))
    .join("");
  // "PR 58 (link)" and "PR 58: link" are one stub.
  text = text.replace(new RegExp(`${PR_NUMBER.source}\\s*[(:,]?\\s*(${TOKEN}\\d+${TOKEN})\\)?`, "gi"), "$2");
  text = text
    // "the old draft PR 55" is "the old draft"; a PR named on its own is "the change".
    .replace(new RegExp(`\\b(the|this|that|its|old|draft|open|new|older|newer)\\s+${PR_NUMBER.source}`, "gi"), "$1")
    .replace(PR_NUMBER, (_match, _number: string, offset: number, whole: string) => (/(?:^|[.!?]\s+|^\s*(?:[-*+]|\d+[.)])\s+)$/.test(whole.slice(0, offset)) ? "The change" : "the change"))
    .replace(/\bPRs\b/g, "changes")
    .replace(/\bPR\b/g, "change")
    .replace(new RegExp(`\\s*(?:(?:on|in|from|to)\\s+)?(?:the\\s+)?(?:branch\\s+)?${BRANCH.source}(?:\\s+branch)?`, "g"), "")
    .replace(new RegExp(`\\s*(?:(?:as|at|in|onto|to|commit)\\s+)?(?:commit\\s+)?${HASH.source}`, "g"), "")
    .replace(RATIO, (match, a: string, b: string, counted?: string) => (a === b || counted ? "" : match))
    .replace(CHECK_COUNT, (_match, kind: string) => (kind.toLowerCase().startsWith("check") ? "checks" : "tests"));
  return text
    .split("\n")
    .map((line) => {
      const item = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line);
      if (item) return relink(line, urls);
      if (!line.includes(TOKEN)) return line;
      return sentences(line).map((sentence) => relink(sentence, urls)).join(" ").replace(/^(?=\S)/, line.match(/^\s*/)![0]);
    })
    .join("\n")
    .replace(new RegExp(TOKEN, "g"), "");
}

/** Firstmate's engineering stubs taken out of Markdown prose; code blocks are left as written. */
export function withoutStubs(text: string): string {
  return text
    .split(FENCED)
    .map((part, index) => (index % 2 === 1 ? part : stripProse(part)))
    .join("");
}

// ── Status card ────────────────────────────────────────────────────────────

export type WorkState = "needs" | "underway" | "landed";

export interface StatusItem {
  text: string;
  state: WorkState;
  urls: string[];
  /** The project the work belongs to, when its link names one. */
  project?: string;
  /** What follows from it ("being updated, will merge when green"), quieter under the line. */
  detail?: string;
}

const NEEDS = /\b(?:waiting (?:on|for) (?:you|your)|needs? (?:you|your)|your (?:call|decision|word|ok|go-ahead|approval)|say ["“']|blocked|ready (?:for (?:your )?review|to merge)|for your (?:review|ok)|approve)\b/i;
const UNDERWAY = /\b(?:being|under ?way|in progress|working on|bringing|updating|will (?:merge|land|ship)|still going|in (?:its )?(?:checks|review)|queued|started|running|in flight|final review)\b/i;
const LANDED = /\b(?:merged|landed|shipped|is live|went live|released|deployed|done|finished|complete)\b/i;
const NOT_YET = /\b(?:never|not|isn't|wasn't|hasn't|unmerged|until|before)\b/i;

export function stateOf(text: string): WorkState | null {
  if (NEEDS.test(text)) return "needs";
  if (UNDERWAY.test(text)) return "underway";
  if (LANDED.test(text)) return NOT_YET.test(text) ? "underway" : "landed";
  return null;
}

const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+(.*)$/;

interface Block {
  kind: "item" | "text" | "blank";
  line: string;
}

/** The project a link belongs to, by its repository ("good-neighbours" → "Good Neighbours"). */
function projectOf(url: string | undefined): string | undefined {
  const pull = url ? GITHUB_PULL.exec(url) : null;
  return pull ? pull[1]!.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : undefined;
}

/** The Markdown links of an item, then its text with them flattened. */
function itemOf(raw: string, state: WorkState): StatusItem {
  const urls = [...raw.matchAll(LINK)].map((match) => match[2]!);
  const said = clip(inline(sentences(inline(raw))[0] ?? inline(raw)).replace(/[,;:.]+$/, ""), 140);
  // "X clashed with what landed, so it's being updated" → the line, then what follows from it.
  const split = /^(.{12,}?)(?:,\s+so\s+|\s+[—–]\s+|;\s+)(.+)$/.exec(said);
  const project = projectOf(urls[0]);
  return { text: capitalise(split ? split[1]! : said), state, urls, ...(project ? { project } : {}), ...(split ? { detail: capitalise(split[2]!) } : {}) };
}

const COUNTS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** Items that only name where the work lives ("Flyd change") become one, with every link. */
function merge(items: StatusItem[]): StatusItem[] {
  const out: Array<StatusItem & { bare?: string }> = [];
  for (const item of items) {
    const bare = item.urls.length === 1 && / change$/.test(item.text) ? item.text.replace(/ change$/, "") : undefined;
    const same = bare ? out.find((candidate) => candidate.bare === bare && candidate.state === item.state) : undefined;
    if (same) {
      same.urls.push(...item.urls);
      same.text = `${COUNTS[same.urls.length] ?? same.urls.length} ${bare} changes`;
      continue;
    }
    out.push({ ...item, urls: [...item.urls], ...(bare ? { bare } : {}) });
  }
  return out.map(({ bare: _bare, ...item }) => item);
}

export interface Briefing {
  /** The reply with its status lists taken out and its other lists made prose. */
  prose: string;
  /** The status card's items, in the order he should read them: needs him, under way, landed. */
  items: StatusItem[];
}

const ORDER: Record<WorkState, number> = { needs: 0, underway: 1, landed: 2 };

/** A short list of fragments ("the hat tilted", "buttons stay square") joined onto its lead-in. */
function listAsProse(lead: string | undefined, items: string[]): string[] {
  const clean = items.map((item) => item.trim().replace(/[,;]$/, "").replace(/\.$/, ""));
  const fragments = clean.every((item) => item.length < 90 && !/[.!?]\s/.test(item));
  if (fragments && clean.length > 1) {
    const series = `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
    if (lead !== undefined && /:\s*(?:\*\*|__)?\s*$/.test(lead)) return [`${lead.replace(/\s*$/, "")} ${series}.`];
    return [...(lead !== undefined ? [lead] : []), `${capitalise(series)}.`];
  }
  const said = clean.map((item) => capitalise(/[.!?)]$/.test(item) ? item : `${item}.`)).join(" ");
  return [...(lead !== undefined ? [lead.replace(/:(\s*(?:\*\*|__)?)\s*$/, ".$1")] : []), said];
}

/**
 * A reply as Flyd briefs him: list runs whose items carry a state of work
 * (landed, under way, needs him) become status-card items when there are at
 * least two of them; every other list reads as prose.
 */
export function briefing(text: string): Briefing {
  const parts = text.split(FENCED);
  const items: StatusItem[] = [];
  const out = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    const lines = part.split("\n");
    const blocks: Block[] = [];
    for (const line of lines) {
      if (!line.trim()) blocks.push({ kind: "blank", line });
      else if (LIST_ITEM.test(line.trim()) && !/^\s{2,}/.test(line)) blocks.push({ kind: "item", line: LIST_ITEM.exec(line.trim())![1]! });
      else if (/^\s{2,}\S/.test(line) && blocks.length && blocks[blocks.length - 1]!.kind === "item") {
        const last = blocks[blocks.length - 1]!;
        const nested = LIST_ITEM.exec(line.trim());
        last.line = `${last.line.replace(/[:\s]*$/, "")}${nested ? (/[:]$/.test(last.line.trim()) ? ": " : ", ") : " "}${nested ? nested[1] : line.trim()}`;
      } else blocks.push({ kind: "text", line });
    }
    const result: string[] = [];
    let i = 0;
    while (i < blocks.length) {
      const block = blocks[i]!;
      if (block.kind !== "item") {
        result.push(block.line);
        i += 1;
        continue;
      }
      const run: string[] = [];
      while (i < blocks.length && blocks[i]!.kind === "item") run.push(blocks[i++]!.line);
      // The line that introduces the list ("**Flyd (merged):**", "Still waiting on your word for:").
      let leadAt = result.length - 1;
      while (leadAt >= 0 && !result[leadAt]!.trim()) leadAt -= 1;
      const lead = leadAt >= 0 && /:\s*(?:\*\*|__)?\s*$/.test(result[leadAt]!) ? result[leadAt] : undefined;
      const context = lead ? stateOf(lead) : null;
      const states = run.map((item) => stateOf(inline(item)) ?? context);
      const known = states.filter(Boolean).length;
      if (known >= 2 || (known >= 1 && run.length >= 1 && context !== null)) {
        const leftovers: string[] = [];
        run.forEach((item, at) => (states[at] ? items.push(itemOf(item, states[at]!)) : leftovers.push(item)));
        // A lead-in that only labelled the list ("**Flyd (merged):**") goes with it.
        if (lead !== undefined && inline(lead).replace(/:\s*$/, "").split(/\s+/).length <= 5) result.splice(leadAt, 1);
        else if (lead !== undefined) result[leadAt] = lead.replace(/(?:\s+(?:for|on|to|of|with|about))?\s*:\s*(\*\*|__)?\s*$/, ".$1");
        if (leftovers.length) result.push(...listAsProse(undefined, leftovers));
        continue;
      }
      if (lead !== undefined) result.splice(leadAt, 1, ...listAsProse(lead, run));
      else result.push(...listAsProse(undefined, run));
    }
    return result.join("\n").replace(/\n{3,}/g, "\n\n");
  });
  const merged = merge(items);
  return { prose: out.join("").trim(), items: items.length >= 2 ? [...merged].sort((a, b) => ORDER[a.state] - ORDER[b.state]) : [] };
}

const GROUP: Record<WorkState, { title: string; kind: string }> = {
  needs: { title: "Needs you", kind: "k-call" },
  underway: { title: "Under way", kind: "k-live" },
  landed: { title: "Landed", kind: "k-landed" },
};

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : null;
}

/**
 * The status card: the work grouped by what it asks of him (needs you, under
 * way, landed), each piece one plain line with a coloured light. The line
 * opens the work; when one line stands for several, each extra light opens
 * the next. The project shows only when the work spans more than one.
 */
export function statusCardHtml(items: StatusItem[]): string {
  const projects = new Set(items.map((item) => item.project ?? ""));
  const named = projects.size > 1;
  let index = 0;
  const groups = (Object.keys(GROUP) as WorkState[]).flatMap((state) => {
    const mine = items.filter((item) => item.state === state);
    if (mine.length === 0) return [];
    const rows = mine.map((item) => {
      const href = item.urls[0] ? safeHref(item.urls[0]) : null;
      const text = escapeHtml(item.text);
      const label = href ? `<a class="sc-text" href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : `<span class="sc-text">${text}</span>`;
      const lights = item.urls.slice(1).map((url) => safeHref(url)).filter(Boolean)
        .map((url) => `<a class="sc-led" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open the next one"></a>`).join("");
      const project = named && item.project ? `<span class="sc-project">${escapeHtml(item.project)}</span>` : "";
      const detail = item.detail ? `<span class="sc-detail">${escapeHtml(item.detail)}</span>` : "";
      return `<li class="sc-row" style="--i:${index++}"><span class="sc-led" aria-hidden="true"></span><span class="sc-what">${label}${lights}${project}${detail}</span></li>`;
    });
    const count = mine.reduce((sum, item) => sum + Math.max(1, item.urls.length), 0);
    return [`<section class="sc-group ${GROUP[state].kind}"><h4 class="sc-kicker">${GROUP[state].title}<span class="sc-count">${count}</span></h4><ul>${rows.join("")}</ul></section>`];
  });
  return `<div class="status-card" role="group" aria-label="Where the work stands">${groups.join("")}</div>`;
}

/** A reply as Flyd briefs him: stubs out, lists as prose, the work's states as card items. */
export function brief(text: string): Briefing {
  return briefing(withoutStubs(text));
}

/** A reply rendered for his window: stubs gone, lists as prose, a multi-item status as a card under its lead. */
export function renderBriefing(text: string): string {
  const { prose, items } = brief(text);
  if (items.length === 0) return renderMarkdown(prose);
  const [lead, ...rest] = prose.split(/\n\s*\n/);
  return `${lead?.trim() ? renderMarkdown(lead) : ""}${statusCardHtml(items)}${rest.length ? renderMarkdown(rest.join("\n\n")) : ""}`;
}

const ASKS = /\?|\b(?:say ["“']|do you want|would you like|should i|shall i|want me to|your (?:call|decision|word|ok|go-ahead)|needs? your)\b/i;

/**
 * The summary of a reply that reports several pieces of work: a one-line
 * lead (Flyd's own reading when it has one, else the reply's opening), the
 * status card, then every sentence that asks something of him. Undefined
 * when the reply is not a multi-item status.
 */
export function statusSummaryHtml(text: string, reading?: string): string | undefined {
  const { prose, items } = brief(text);
  if (items.length === 0) return undefined;
  const [opening = "", ...rest] = prose.split(/\n\s*\n/);
  const asks = rest.flatMap((paragraph) => sentences(inline(paragraph)).filter((sentence) => ASKS.test(sentence)));
  const lead = reading ? renderBriefing(reading) : renderMarkdown(opening);
  return `${lead}${statusCardHtml(items)}${!reading && asks.length ? renderMarkdown(asks.join(" ")) : ""}`;
}

/** The status in a few words for the island: "Two need you · one under way · three landed". */
export function statusHeadline(items: StatusItem[]): string {
  const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const count = (state: WorkState) => items.filter((item) => item.state === state).reduce((sum, item) => sum + Math.max(1, item.urls.length), 0);
  const parts: string[] = [];
  const needs = count("needs");
  const underway = count("underway");
  const landed = count("landed");
  if (needs) parts.push(`${WORDS[needs] ?? needs} ${needs === 1 ? "needs" : "need"} you`);
  if (underway) parts.push(`${WORDS[underway] ?? underway} under way`);
  if (landed) parts.push(`${WORDS[landed] ?? landed} landed`);
  return capitalise(parts.join(" · "));
}
