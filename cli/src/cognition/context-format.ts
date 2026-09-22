import type { CompiledContext } from "./types.js";

export function formatCompiledContext(context: CompiledContext): string {
  const claimLine = (c: CompiledContext["memory"]["current"][number]) =>
    `- [${c.temporalStatus}; ${c.authority}] ${c.entityId} · ${c.attribute}: ${c.value}`;
  const historicalLine = (c: CompiledContext["memory"]["historical"][number]) =>
    `- [${c.temporalStatus}; historical] ${c.entityId} · ${c.attribute}: ${c.value}`;
  return [
    "<flyd_context>",
    "<profile>", context.user.profile || "(no profile projection)", "</profile>",
    "<now>",
    context.present.projection || "",
    `Active projects: ${context.present.activeProjects.join(", ") || "none"}`,
    ...context.memory.current.slice(0,20).map(claimLine),
    "</now>",
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
    ...context.memory.conflicts.map((c) => `- conflict ${c.entityId}.${c.attribute}: ${c.claims.join(" vs ")}`),
    ...context.memory.gaps.map((g) => `- gap: ${g}`),
    ...context.present.gaps.map((g) => `- present gap: ${g}`),
    "</uncertainty>",
    "</flyd_context>",
  ].filter(Boolean).join("\n");
}
