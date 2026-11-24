import { createHash } from "node:crypto";

/** The initial governed scalar scopes. Unknown prose never authorizes destructive replacement. */
export const GOVERNED_PROPERTIES = ["launch_date", "deadline", "hosting_provider", "timezone"] as const;

export function groundedProperty(text: string): { subject: string; property: string; value: string } | null {
  if (typeof text !== "string") return null;
  const match = text.trim().match(/^(?:(?:correction|actually|remember)\s*[:,]?\s*)?(?:the\s+)?([\p{L}][\p{L}\p{N} ._-]{1,65}?)\s+(launch date|deadline|hosting provider|timezone)\s+(?:is\s+(?:now\s+)?|now\s+|:\s*)([^\n?]+?)[.!]?$/iu);
  if (!match || /\b(?:if|maybe|could|would|imagine|suppose|hypothetically|should|might)\b|["“”`]/i.test(match[0]) || /^(?:not|never|maybe)\b/i.test(match[3])) return null;
  return { subject: match[1].trim(), property: match[2].toLowerCase().replace(/ /g, "_"), value: match[3].trim() };
}

export const projectFactEntity = (subject: string): string => `project:${subject.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`;

/** Payload-free scope guard: erasure must not reactivate a retired legacy writer. */
export const knowledgeScopeHash = (entityId: string, property: string, scopeId = entityId): string =>
  createHash("sha256").update(JSON.stringify([entityId, property, scopeId])).digest("hex");
