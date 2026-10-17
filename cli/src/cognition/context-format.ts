import type { CompiledContext } from "./types.js";

/** Attributes that change as work happens; successive values are history, not contradictions. */
const VOLATILE_ATTRIBUTES = new Set(["branch", "dirty", "latest_commit", "head", "changed_files", "ahead", "behind"]);

/** Real contradictions only: at least two distinct values on a stable attribute. */
export function meaningfulConflicts(conflicts: CompiledContext["memory"]["conflicts"]) {
  return conflicts
    .filter((conflict) => !VOLATILE_ATTRIBUTES.has(conflict.attribute))
    .map((conflict) => ({ ...conflict, claims: [...new Set(conflict.claims.map((claim) => String(claim).trim()))] }))
    .filter((conflict) => conflict.claims.length >= 2)
    .slice(0, 8);
}

/** Longest span of text for one memory line in a prompt; the full record stays in the store. */
const MAX_LINE_CHARS = 240;
const MAX_NOW_CHARS = 4000;
const MAX_ACTIVE_LINES = 25;
const MAX_COMPLETED_LINES = 5;
/** Repo state older than this is stale: it is dropped rather than labelled current. */
const REPO_STALE_DAYS = 7;
const REPO_LINE = /^- \[[^\]]*?observed (\d{4}-\d{2}-\d{2})[^\]]*\] (project:[^ ]+) · ([a-z_]+):/;

/** Cut text to `max` characters on a line boundary, marking that it was trimmed. */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}\n…(trimmed)`;
}

function clampLine(line: string, max = MAX_LINE_CHARS): string {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * The NOW projection is a full dump of the world model (tens of KB). A prompt
 * gets a bounded view: fresh claims only, no evidence ids, no conflict list,
 * so stale repo state is never presented as current and contradictions in the
 * dump never reach George-facing answers.
 */
export function boundNowProjection(text: string, now = new Date()): string {
  if (!text) return "";
  const staleBefore = now.getTime() - REPO_STALE_DAYS * 86_400_000;
  const active: string[] = [];
  const completed: string[] = [];
  let section: "active" | "completed" | "other" = "other";
  for (const raw of text.split("\n")) {
    if (raw.startsWith("## ")) {
      section = raw.startsWith("## Active now") ? "active" : raw.startsWith("## Recently completed") ? "completed" : "other";
      continue;
    }
    if (!raw.startsWith("- ") || section === "other") continue;
    const repo = REPO_LINE.exec(raw);
    if (repo && VOLATILE_ATTRIBUTES.has(repo[3]) && Date.parse(repo[1]) < staleBefore) continue;
    if (/^- (No canonical|None)/.test(raw)) continue;
    const line = clampLine(raw.replace(/; evidence:[^\]]*\]/, "]"));
    (section === "active" ? active : completed).push(line);
  }
  const out = [
    ...(active.length ? ["Active now:", ...active.slice(0, MAX_ACTIVE_LINES)] : []),
    ...(completed.length ? ["Recently completed:", ...completed.slice(0, MAX_COMPLETED_LINES)] : []),
  ].join("\n");
  return clampText(out, MAX_NOW_CHARS);
}

/** A repository fact nobody has re-observed lately is history, not present state. */
export function isStaleRepoClaim(
  claim: { entityId: string; attribute: string; observedAt?: string },
  now = new Date(),
): boolean {
  if (!claim.entityId.startsWith("project:") || !VOLATILE_ATTRIBUTES.has(claim.attribute) || !claim.observedAt) return false;
  return Date.parse(claim.observedAt) < now.getTime() - REPO_STALE_DAYS * 86_400_000;
}

export interface FormatContextOptions {
  /** Clock for the freshness cut; tests pin it. */
  now?: Date;
  /** Personal turns skip repository state and project projections. */
  includeProjects?: boolean;
  /** Design, code and work-state turns follow George's learned taste; companion chat, LIVE and resolve never see it. */
  includeTaste?: boolean;
}

export function formatCompiledContext(context: CompiledContext, options: FormatContextOptions = {}): string {
  const includeProjects = options.includeProjects ?? true;
  const isRepoClaim = (c: { entityId: string; attribute: string }) =>
    c.entityId.startsWith("project:") && VOLATILE_ATTRIBUTES.has(c.attribute);
  const claimLine = (c: CompiledContext["memory"]["current"][number]) =>
    `- [${c.temporalStatus}; ${c.authority}] ${c.entityId} · ${c.attribute}: ${c.value}`;
  const historicalLine = (c: CompiledContext["memory"]["historical"][number]) =>
    `- [${c.temporalStatus}; historical] ${c.entityId} · ${c.attribute}: ${c.value}`;
  return [
    "<flyd_context>",
    "<profile>", context.user.profile || "(no profile projection)", "</profile>",
    ...(options.includeTaste && context.user.taste ? ["<taste>", context.user.taste, "</taste>"] : []),
    "<now>",
    includeProjects ? boundNowProjection(context.present.projection || "", options.now) : "",
    `Active projects: ${context.present.activeProjects.join(", ") || "none"}`,
    ...context.memory.current.filter((c) => !isStaleRepoClaim(c, options.now) && (includeProjects || !isRepoClaim(c))).slice(0,20).map((c) => clampLine(claimLine(c))),
    "</now>",
    ...(includeProjects ? [
      "<projects>",
      ...context.projects.map((project) => `## ${project.id}\n${clampText(project.projection, 2500)}`),
      "</projects>",
    ] : []),
    "<conversation-state>",
    context.conversation.recap || "(none)",
    Object.keys(context.conversation.referents).length ? `Referents: ${JSON.stringify(context.conversation.referents)}` : "",
    "</conversation-state>",
    "<relevant-memory>",
    ...context.memory.relevant.slice(0,8).map((m) => `- [${m.temporalStatus}; relevance=${m.relevance.toFixed(2)}] ${clampLine(m.content, 600)}`),
    "</relevant-memory>",
    "<historical-memory>",
    ...context.memory.historical.slice(0,10).map((c) => clampLine(historicalLine(c))),
    "</historical-memory>",
    "<uncertainty>",
    ...meaningfulConflicts(context.memory.conflicts).slice(0, 3).map((c) => clampLine(`- conflict ${c.entityId}.${c.attribute}: ${c.claims.join(" vs ")}`)),
    ...context.memory.gaps.map((g) => `- gap: ${g}`),
    ...context.present.gaps.map((g) => `- present gap: ${g}`),
    "</uncertainty>",
    "</flyd_context>",
  ].filter(Boolean).join("\n");
}
