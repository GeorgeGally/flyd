import { readFileSync } from "node:fs";
import { join } from "node:path";
import { knowledgeProjectionPaths } from "../cognition/projections/store.js";
import type { DictationTarget } from "./profile.js";
import { redactSensitiveText } from "../runtime/context-redactor.js";

/** Invocation-only context. Never persisted; provider egress contains terms only. */
export interface VoiceContext {
  capturedAt: string;
  selectedText?: string;
  nearbyText?: string;
  documentTitle?: string;
}

export function parseVoiceContext(value: unknown, now = Date.now()): VoiceContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const at = typeof v.capturedAt === "string" ? Date.parse(v.capturedAt) : NaN;
  if (!Number.isFinite(at) || at > now + 5000 || now - at > 30_000) return undefined;
  const text = (key: string, limit: number) => typeof v[key] === "string"
    ? (v[key] as string).slice(0, limit) : undefined;
  return { capturedAt: v.capturedAt as string, selectedText: text("selectedText", 1000),
    nearbyText: text("nearbyText", 2000), documentTitle: text("documentTitle", 300) };
}

/** Names/identifiers only, not sentences, URLs, credentials, or prompt instructions. */
export function contextualTerms(text: string): string[] {
  text = redactSensitiveText(text);
  return [...new Set(text.match(/\b(?:[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Z]{2,}[A-Za-z0-9]*|[a-zA-Z][\w-]*\.(?:ts|tsx|js|json|swift|rb|md)|[A-Z][a-z]{2,})\b/g) ?? [])]
    .filter(term => term.length <= 48 && !/^(?:Ignore|Output|Return|Please|System|Assistant|User|Token|Secret|Password|REDACTED)$/i.test(term))
    .slice(0, 24);
}

export function contextVocabulary(target: DictationTarget, baseline: string[], projectText = ""): string[] {
  const context = target.context;
  const focus = [target.windowTitle, context?.documentTitle, context?.selectedText, context?.nearbyText].filter(Boolean).join(" ");
  const related = baseline.filter(term => focus.toLowerCase().includes(term.toLowerCase()));
  const terms = ["Flyd", ...related, ...contextualTerms(focus), ...contextualTerms(projectText)];
  return [...new Set(terms)].slice(0, 40);
}

/** Read only the matched project projection, never global NOW or unrelated projects. */
export function currentProjectVocabulary(target: DictationTarget, baseline: string[]): string[] {
  const title = [target.windowTitle, target.context?.documentTitle].filter(Boolean).join(" ").toLowerCase();
  const names = baseline.filter(term => term.length >= 3 && title.includes(term.toLowerCase())).slice(0, 2);
  let text = "";
  for (const name of names) {
    const id = "project:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    try { text += readFileSync(join(knowledgeProjectionPaths().projects, id.replace(/[^a-z0-9._-]+/gi, "-") + ".md"), "utf8").split("## History")[0].slice(0, 2000); }
    catch { /* no grounded project */ }
  }
  return contextVocabulary(target, baseline, text);
}
