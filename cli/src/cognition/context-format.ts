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

export interface FormatContextOptions {
  /** Personal turns skip repository state and project projections. */
  includeProjects?: boolean;
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
    "<now>",
    includeProjects ? context.present.projection || "" : "",
    `Active projects: ${context.present.activeProjects.join(", ") || "none"}`,
    ...context.memory.current.filter((c) => includeProjects || !isRepoClaim(c)).slice(0,20).map(claimLine),
    "</now>",
    ...(includeProjects ? [
      "<projects>",
      ...context.projects.map((project) => `## ${project.id}\n${project.projection}`),
      "</projects>",
    ] : []),
    "<conversation-state>",
    context.conversation.recap || "(none)",
    Object.keys(context.conversation.referents).length ? `Referents: ${JSON.stringify(context.conversation.referents)}` : "",
    "</conversation-state>",
    "<relevant-memory>",
    ...context.memory.relevant.slice(0,8).map((m) => `- [${m.temporalStatus}; relevance=${m.relevance.toFixed(2)}] ${m.content}`),
    "</relevant-memory>",
    "<historical-memory>",
    ...context.memory.historical.slice(0,10).map(historicalLine),
    "</historical-memory>",
    "<uncertainty>",
    ...meaningfulConflicts(context.memory.conflicts).map((c) => `- conflict ${c.entityId}.${c.attribute}: ${c.claims.join(" vs ")}`),
    ...context.memory.gaps.map((g) => `- gap: ${g}`),
    ...context.present.gaps.map((g) => `- present gap: ${g}`),
    "</uncertainty>",
    "</flyd_context>",
  ].filter(Boolean).join("\n");
}
