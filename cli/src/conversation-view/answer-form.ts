import { escapeHtml, renderMarkdown } from "./markdown.js";
import type { ManifestationEvidence, ManifestationPart, ManifestationPlan } from "./semantic.js";

export type { ManifestationEvidence, ManifestationPart } from "./semantic.js";

/**
 * An answer with a shape Flyd chose, rather than one string. `answerBody()`
 * turns whatever a producer returns into this, and prose keeps the HTML it
 * has always had.
 */
export type AnswerBody = ManifestationPlan;

const said = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const partsFrom = (value: unknown): ManifestationPart[] => (Array.isArray(value)
  ? value.flatMap((part) => {
    const item = (part && typeof part === "object" ? part : {}) as Record<string, unknown>;
    const label = said(item.label);
    const text = said(item.text);
    return label && text ? [{ label, text }] : [];
  })
  : []);

const evidenceFrom = (value: unknown): ManifestationEvidence[] => (Array.isArray(value)
  ? value.flatMap((item) => {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const text = said(entry.text);
    const url = said(entry.url);
    return text ? [{ text, ...(url ? { url } : {}) }] : [];
  })
  : []);

/** Whatever an answerer returned, as a body: a string is prose, a shape is one only when it is whole. */
export function answerBody(value: unknown): AnswerBody {
  if (typeof value === "string") return { lead: value, form: "prose" };
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const lead = said(record.lead);
  const next = said(record.next);
  if (record.form === "diagnosis") {
    const parts = partsFrom(record.parts);
    const evidence = evidenceFrom(record.evidence);
    if (parts.length) return { lead, form: "diagnosis", parts, ...(evidence.length ? { evidence } : {}), ...(next ? { next } : {}) };
  }
  if (record.form === "comparison") {
    const criteria = Array.isArray(record.criteria) ? record.criteria.map(said) : [];
    const rawAlternatives = Array.isArray(record.alternatives) ? record.alternatives : [];
    const alternatives = rawAlternatives
      .flatMap((item) => {
        const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const name = said(entry.name);
        const values = Array.isArray(entry.values) ? entry.values.map(said) : [];
        return name && values.length === criteria.length && values.every(Boolean) ? [{ name, values }] : [];
      });
    if (criteria.length > 1 && criteria.every(Boolean) && alternatives.length > 1 && alternatives.length === rawAlternatives.length) {
      return { lead, form: "comparison", criteria, alternatives, ...(next ? { next } : {}) };
    }
  }
  return { lead, form: "prose" };
}

/** The body as one string: what history, search and every prose reader keep. */
export function plainAnswer(body: AnswerBody): string {
  if (body.form === "comparison") {
    return [
      body.lead,
      ...body.criteria.map((criterion, index) => [
        criterion,
        ...body.alternatives.map((alternative) => `${alternative.name}: ${alternative.values[index]}`),
      ].join("\n")),
      body.next ?? "",
    ].filter(Boolean).join("\n\n");
  }
  if (body.form === "prose") return body.lead;
  return [
    body.lead,
    ...body.parts.map((part) => `${part.label}\n${part.text}`),
    ...(body.evidence ?? []).map((entry) => (entry.url ? `${entry.text} (${entry.url})` : entry.text)),
    body.next ?? "",
  ].filter(Boolean).join("\n\n");
}

/** The body as the page shows it; prose is exactly the markdown it has always been. */
export function answerHtml(body: AnswerBody): string {
  if (body.form === "prose") return renderMarkdown(body.lead);
  if (body.form === "comparison") {
    const head = body.alternatives.map((alternative) => `<th scope="col">${escapeHtml(alternative.name)}</th>`).join("");
    const rows = body.criteria.map((criterion, index) => [
      `<tr><th scope="row">${escapeHtml(criterion)}</th>`,
      ...body.alternatives.map((alternative) => `<td>${escapeHtml(alternative.values[index] ?? "")}</td>`),
      `</tr>`,
    ].join("")).join("");
    return [
      `<section class="answer-form" data-form="comparison">`,
      `<p class="answer-lead">${escapeHtml(body.lead)}</p>`,
      `<table class="answer-compare"><thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table>`,
      body.next ? `<p class="answer-next">${escapeHtml(body.next)}</p>` : "",
      `</section>`,
    ].filter(Boolean).join("");
  }
  const parts = body.parts
    .map((part) => `<div class="answer-part"><dt>${escapeHtml(part.label)}</dt><dd>${renderMarkdown(part.text)}</dd></div>`)
    .join("");
  const evidence = (body.evidence ?? [])
    .map((entry) => `<li>${entry.url ? `<a href="${escapeHtml(entry.url)}" rel="noreferrer">${escapeHtml(entry.text)}</a>` : escapeHtml(entry.text)}</li>`)
    .join("");
  return [
    `<section class="answer-form" data-form="diagnosis">`,
    `<p class="answer-lead">${escapeHtml(body.lead)}</p>`,
    parts ? `<dl class="answer-parts">${parts}</dl>` : "",
    evidence ? `<ul class="answer-evidence">${evidence}</ul>` : "",
    body.next ? `<p class="answer-next">${escapeHtml(body.next)}</p>` : "",
    `</section>`,
  ].filter(Boolean).join("");
}

const DIAGNOSIS_LABELS = ["Expected", "Observed", "Cause", "Evidence", "Next"] as const;

/**
 * A diagnosis the model declared in its own words: a bold outcome line, then
 * exactly the five labelled lines. Anything else is left as prose.
 */
export function diagnosisFromText(text: string): AnswerBody | null {
  const markers = [...text.matchAll(/\*\*\s*(Expected|Observed|Cause|Evidence|Next)\s*:?\s*\*\*/gi)];
  if (markers.length !== DIAGNOSIS_LABELS.length) return null;
  const labels = markers.map((marker) => DIAGNOSIS_LABELS.find((label) => label.toLowerCase() === marker[1]!.toLowerCase())!);
  if (new Set(labels).size !== DIAGNOSIS_LABELS.length) return null;
  const parts = markers.map((marker, index) => ({
    label: labels[index]!,
    text: text.slice((marker.index ?? 0) + marker[0].length, markers[index + 1]?.index ?? text.length).trim(),
  }));
  if (parts.some((part) => !part.text)) return null;
  const opener = /^\s*\*\*\s*Diagnosis\s*:?\s*([\s\S]+?)\s*\*\*/.exec(text);
  const preamble = text.slice(0, markers[0]!.index ?? 0).replace(/\*\*/g, "").trim();
  const lead = opener?.[1]?.trim() || preamble;
  return lead ? { lead, form: "diagnosis", parts } : null;
}
