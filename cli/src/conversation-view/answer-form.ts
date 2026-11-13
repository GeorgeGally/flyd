import { HIS_TASTE, NEVER, speaksForHim } from "./auto-answers.js";
import { forHim } from "../lib/pa-voice.js";
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

/** A yes-or-no ask for leave to take a step: "Should I send the link?", "Want me to open it?". */
const LEAVE_TO = /^(?:(?:should|shall) I|(?:do you want|would you like|want) me to)\s+(.+?)\s*\?$/i;
/** Steps that reach past his own machine: landing or pushing work stays his yes. */
const OUTWARD = /\b(?:merg|land|push|ship|commit)/i;

/**
 * The obvious next step of his own ask said as what Flyd is doing, not asked:
 * a question the rest of the answer already commits Flyd to ("…and will send
 * you the link. Should I send the link?"). A real choice stays a question:
 * either/or, destructive, costly, public, outward, a taste call, or a step
 * the answer never said it was taking. Pure.
 */
export function doingNotAsking(question: string, answer: string): string {
  const step = LEAVE_TO.exec(question.trim())?.[1];
  const verb = step ? /^[a-z]+/i.exec(step)?.[0] : undefined;
  if (!step || !verb || /\bor\b/i.test(step) || NEVER.test(step) || OUTWARD.test(step) || HIS_TASTE.test(step) || speaksForHim(step)) return question;
  const then = `\\s+(?:also\\s+|then\\s+)?${verb}\\b`;
  return new RegExp(`\\b(?:(?:I|we)['’]ll|(?:I|we) will|(?:I['’]m|we['’]re|I am|we are) going to)${then}|\\b(?:I|we)\\b[^.!?;\\n]*?\\band will${then}`, "i").test(answer) ? `I'll ${step}.` : question;
}

/** An answer whose closing question only asks leave for the obvious next step, ending on that step instead. Pure. */
export function withoutObviousAsk(text: string): string {
  const closing = /[^\s.!?][^\n.!?]*\?\s*$/.exec(text);
  if (!closing) return text;
  const before = text.slice(0, closing.index);
  const ask = closing[0].trim();
  const done = doingNotAsking(ask, before);
  return done === ask ? text : `${before}${done}`;
}

/** Whatever an answerer returned, as a body: a string is prose, a shape is one only when it is whole. */
export function answerBody(value: unknown): AnswerBody {
  // Whatever wrote it, he hears it from his PA: to him, no report labels, no leave-to-tell question.
  if (typeof value === "string") return { lead: withoutObviousAsk(forHim(value)), form: "prose" };
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const lead = forHim(said(record.lead));
  const told = [lead, ...partsFrom(record.parts).map((part) => part.text)].join("\n");
  const next = doingNotAsking(forHim(said(record.next)), told);
  if (record.form === "diagnosis") {
    const parts = partsFrom(record.parts);
    const evidence = evidenceFrom(record.evidence);
    if (parts.length) return { lead, form: "diagnosis", parts, ...(evidence.length ? { evidence } : {}), ...(next ? { next } : {}), ...(record.askedWhy === true ? { askedWhy: true } : {}) };
  }
  if (record.form === "gallery") {
    const originals = Array.isArray(record.items) ? record.items : [];
    const items = originals.flatMap((raw) => {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const title = said(item.title);
      const imageUrl = said(item.imageUrl);
      const description = said(item.description);
      const sourceUrl = said(item.sourceUrl);
      // Render only sourced HTTPS images. Missing/malformed images leave the
      // original answer untouched rather than inventing a visual.
      if (!title || !description || !/^https:\/\/[^\s<>"']+$/i.test(imageUrl)) return [];
      if (sourceUrl && !/^https:\/\/[^\s<>"']+$/i.test(sourceUrl)) return [];
      return [{ title, imageUrl, description, ...(sourceUrl ? { sourceUrl } : {}) }];
    });
    if (items.length >= 2 && items.length <= 8 && items.length === originals.length) {
      return { form: "gallery", lead, items };
    }
  }
  if (record.form === "briefing") {
    const originals = Array.isArray(record.facts) ? record.facts : [];
    const facts = originals.flatMap((raw) => {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const label = said(item.label);
      const value = said(item.value);
      const source = said(item.source);
      const asOf = said(item.asOf);
      if (!label || !value) return [];
      return [{ label, value, ...(source ? { source } : {}), ...(asOf ? { asOf } : {}) }];
    });
    if (facts.length >= 1 && facts.length <= 12 && facts.length === originals.length) {
      return { form: "briefing", lead, facts };
    }
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
  return { lead: withoutObviousAsk(lead), form: "prose" };
}

/** The body as one string: what history, search and every prose reader keep. */
export function plainAnswer(body: AnswerBody): string {
  if (body.form === "gallery") {
    return [body.lead, ...body.items.map((item) =>
      [item.title, item.description, item.sourceUrl ?? item.imageUrl].join(" — "))].join("\n\n");
  }
  if (body.form === "briefing") {
    return [body.lead, ...body.facts.map((fact) =>
      [fact.label + ": " + fact.value, fact.source ? "Source: " + fact.source : "", fact.asOf ? "As of: " + fact.asOf : ""].filter(Boolean).join(" — "))].join("\n");
  }
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

/** The sections of Flyd's own working diagnosis: what drives its work and its handoffs, never what George reads. */
const WORKING_LABELS = new Set(["expected", "observed", "cause", "evidence", "next"]);

/** A sentence's end, but not the stop inside an abbreviation such as "e.g." or "i.e.". */
const FIRST_SENTENCE = /^[\s\S]*?(?<!\b(?:e\.g|i\.e|vs|cf|approx|incl))[.!?](?=\s|$)/i;

/**
 * What George reads of a diagnosis Flyd wrote for itself: one line on what it
 * found and one on what happens next, as a PA would say it. The labelled
 * sections stay on the record for Flyd's history and handoffs.
 */
export function workingReply(body: AnswerBody): string | null {
  if (body.form !== "diagnosis" || !body.parts.every((part) => WORKING_LABELS.has(part.label.trim().toLowerCase()))) return null;
  const part = (label: string): string => body.parts.find((entry) => entry.label.trim().toLowerCase() === label)?.text ?? "";
  const next = body.next || part("next");
  // He asked why, so the cause is his answer: its first sentence, plainly, without the evidence behind it.
  const cause = body.askedWhy ? (FIRST_SENTENCE.exec(part("cause").trim())?.[0] ?? part("cause")) : "";
  return [[body.lead, cause].map((line) => line.trim()).filter(Boolean).join(" "), next].map((line) => line.trim()).filter(Boolean).join("\n\n");
}

/** The body as the page shows it; prose is exactly the markdown it has always been. */
export function answerHtml(body: AnswerBody): string {
  if (body.form === "prose") return renderMarkdown(body.lead);
  if (body.form === "gallery") {
    const items = body.items.map((item) => [
      '<figure class="answer-gallery-item">',
      '<img loading="lazy" referrerpolicy="no-referrer" src="' + escapeHtml(item.imageUrl) + '" alt="' + escapeHtml(item.title) + '">',
      '<figcaption><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.description) + '</span>',
      item.sourceUrl ? '<a href="' + escapeHtml(item.sourceUrl) + '" rel="noreferrer noopener" target="_blank">Source</a>' : '',
      '</figcaption></figure>',
    ].join("")).join("");
    return '<section class="answer-form answer-gallery" data-form="gallery"><p class="answer-lead">'
      + escapeHtml(body.lead) + '</p><div class="answer-gallery-grid">' + items + '</div></section>';
  }
  if (body.form === "briefing") {
    const facts = body.facts.map((fact) =>
      '<div class="answer-briefing-fact"><dt>' + escapeHtml(fact.label) + '</dt><dd>'
      + escapeHtml(fact.value) + '</dd>'
      + (fact.source || fact.asOf ? '<small>' + escapeHtml([fact.source, fact.asOf].filter(Boolean).join(" · ")) + '</small>' : '')
      + '</div>').join("");
    return '<section class="answer-form answer-briefing" data-form="briefing"><p class="answer-lead">'
      + escapeHtml(body.lead) + '</p><dl class="answer-briefing-facts">' + facts + '</dl></section>';
  }
  const reply = workingReply(body);
  if (reply !== null) return renderMarkdown(reply);
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
