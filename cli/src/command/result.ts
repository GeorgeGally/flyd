import type { DomainResult, InformationLossRisk, SpecialistOutput } from "./types.js";

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];

function recommendation(value: unknown): DomainResult["recommendation"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const action = String(record.action ?? "").trim();
  if (!action) return undefined;
  const confidence = Number(record.confidence);
  return {
    action,
    ...(String(record.reasoning ?? "").trim() ? { reasoning: String(record.reasoning).trim() } : {}),
    ...(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
  };
}

function specialistOutputs(value: unknown): SpecialistOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const outcome = String(record.outcome ?? "").trim();
    if (!outcome) return [];
    return [{
      ...(String(record.specialist ?? "").trim() ? { specialist: String(record.specialist).trim() } : {}),
      outcome,
      ...(strings(record.evidence).length ? { evidence: strings(record.evidence) } : {}),
      ...(strings(record.artifacts).length ? { artifacts: strings(record.artifacts) } : {}),
      ...(String(record.raw ?? "").trim() ? { raw: String(record.raw).trim() } : {}),
    }];
  });
}

/** The structured fields a reply carries, whether it writes them as JSON or as "key: value" lines. */
const STRUCTURED_KEYS = new Set([
  "status", "brief", "summary", "report", "detailedreport", "detail",
  "evidence", "recommendation", "risks", "artifacts", "decisionsmade",
  "unresolvedquestions", "informationlossrisk", "specialistoutputs",
]);

/**
 * A reply written as "key: value" lines ("status: completed", "brief: done and
 * live…"), the staff's shorthand for the JSON contract. Read it as the same
 * structured reply, so a clear answer closes the run instead of falling to raw
 * prose with the shape unmet. Only a status Flyd knows makes it structured: any
 * other ("Status: Blocked") stays prose for the judge to read.
 */
function keyValueFields(raw: string): Record<string, unknown> | undefined {
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Za-z_][\w _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase().replace(/[\s_-]/g, "");
    if (!STRUCTURED_KEYS.has(key) || fields[key] !== undefined) continue;
    fields[key] = match[2]!;
  }
  const first = (...keys: string[]): string => keys.map((key) => fields[key]).find((value) => value?.trim())?.trim() ?? "";
  const status = knownStatus(first("status"));
  if (!status) return undefined;
  const brief = first("brief", "summary");
  const report = first("detailedreport", "report", "detail");
  const evidence = first("evidence");
  return {
    status,
    ...(brief ? { brief } : {}),
    ...(report ? { detailed_report: report } : {}),
    ...(evidence ? { evidence: [evidence] } : {}),
  };
}

/** A reply's own status in any spelling ("Completed", "needs decision", "done"), or undefined when it names none Flyd knows. */
function knownStatus(value: unknown): "completed" | "needs_decision" | "failed" | "working" | undefined {
  const status = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "done" || status === "finished") return "completed";
  return status === "needs_decision" || status === "failed" || status === "completed" || status === "working" ? status : undefined;
}

/** A structured reply from its fields, or undefined when it names no brief and no report. */
function structuredResult(raw: string, parsed: Record<string, unknown>): { status?: "completed" | "needs_decision" | "failed" | "working"; result: DomainResult } | undefined {
  const brief = String(parsed.brief ?? "").trim();
  const detailedReport = String(parsed.detailed_report ?? parsed.detailedReport ?? "").trim();
  if (!brief && !detailedReport) return undefined;
  const riskRaw = String(parsed.information_loss_risk ?? parsed.informationLossRisk ?? "low");
  const risk: InformationLossRisk = riskRaw === "high" || riskRaw === "medium" ? riskRaw : "low";
  const status = knownStatus(parsed.status);
  return {
    ...(status ? { status } : {}),
    result: {
      format: "structured",
      brief: brief || detailedReport.split(/\n+/)[0]!.slice(0, 300),
      ...(recommendation(parsed.recommendation) ? { recommendation: recommendation(parsed.recommendation) } : {}),
      detailedReport: detailedReport || raw,
      decisionsMade: strings(parsed.decisions_made ?? parsed.decisionsMade),
      unresolvedQuestions: strings(parsed.unresolved_questions ?? parsed.unresolvedQuestions),
      risks: strings(parsed.risks),
      evidence: strings(parsed.evidence),
      artifacts: strings(parsed.artifacts),
      specialistOutputs: specialistOutputs(parsed.specialist_outputs ?? parsed.specialistOutputs),
      raw: [raw],
      informationLossRisk: risk,
    },
  };
}

export function parseDomainResult(body: string): { status?: "completed" | "needs_decision" | "failed" | "working"; result: DomainResult } {
  const raw = body.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const built = structuredResult(raw, JSON.parse(match[0]) as Record<string, unknown>);
      if (built) return built;
    } catch {
      // The durable raw reply still survives below.
    }
  }
  const fields = keyValueFields(raw);
  const built = fields && structuredResult(raw, fields);
  if (built) return built;

  const brief = raw.split(/\n+/).map((line) => line.trim()).find(Boolean)?.slice(0, 300) || "Domain work returned no readable summary.";
  return {
    result: {
      format: "raw",
      brief,
      detailedReport: raw,
      decisionsMade: [],
      unresolvedQuestions: [],
      risks: [],
      evidence: [],
      artifacts: [],
      specialistOutputs: [],
      raw: [raw],
      informationLossRisk: "high",
    },
  };
}

export type HandoffLayer = "brief" | "report" | "evidence";

export type HandoffValidation =
  | { ok: true }
  | { ok: false; missing: HandoffLayer[]; reason: string };

/** A URL, a PR or a commit a reply can be checked against: a pointer that stands in for the evidence layer. */
const EVIDENCE_REF = /https?:\/\/\S+|\b(?:pr|pull request)\s*#?\d+\b|\bcommit\s+[0-9a-f]{7,40}\b/i;

/**
 * The layered handoff contract a domain boss must meet before Flyd records its
 * work as done: a brief, a report body, and at least one evidence reference —
 * a URL, a PR or a commit counts as the evidence. Prose with no layers meets
 * none of them, even though Flyd derives a brief and report from it so the raw
 * detail survives.
 */
export function validateDomainHandoff(result: DomainResult): HandoffValidation {
  const structured = result.format === "structured";
  const missing: HandoffLayer[] = [];
  if (!structured || !result.brief.trim()) missing.push("brief");
  if (!structured || !result.detailedReport.trim()) missing.push("report");
  if (!result.evidence.some((item) => item.trim()) && !EVIDENCE_REF.test(`${result.brief}\n${result.detailedReport}`)) missing.push("evidence");
  return missing.length
    ? { ok: false, missing, reason: `domain handoff contract unmet: missing ${missing.join(", ")}` }
    : { ok: true };
}

/** How a reply written in plain prose left the work: the staff often answers that way instead of the JSON contract. */
export type ProseOutcome = "completed" | "needs_decision" | "failed" | "working" | "unclear";

/** Reads a prose reply's outcome, e.g. with Flyd's model; null when it cannot tell. */
export type ProseJudge = (reply: string, intendedOutcome: string) => Promise<ProseOutcome | null>;

const PROSE_OUTCOMES = new Set<ProseOutcome>(["completed", "needs_decision", "failed", "working"]);

/** The fallback when no model can read the reply: it never guesses. Only Flyd's model or a structured reply calls work done, failed or a decision. */
export function proseOutcomeByWords(_reply: string): ProseOutcome {
  return "unclear";
}

/** Flyd's model, wired for reading prose replies; under vitest no model runs, so words alone never settle a run. */
export async function defaultProseJudge(): Promise<ProseJudge | undefined> {
  if (process.env.VITEST) return undefined;
  const { query } = await import("../lib/llm.js");
  return modelProseJudge((prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }));
}

/** Flyd's model reads what a prose reply says happened; any failure leaves it to proseOutcomeByWords. */
export function modelProseJudge(complete: (prompt: string) => Promise<string>): ProseJudge {
  return async (reply, intendedOutcome) => {
    const prompt = [
      "A member of George's coding staff replied in plain prose to work Flyd handed over. Read what the reply says happened.",
      "",
      `The work asked for: ${intendedOutcome.slice(0, 600)}`,
      "",
      "The reply:",
      reply.slice(0, 4_000),
      "",
      "Answer with JSON only: {\"status\": \"completed\" | \"needs_decision\" | \"failed\" | \"working\"}",
      "completed: the work is finished (or the question answered). needs_decision: it asks George to decide, approve or answer something before it can go on.",
      "failed: it could not be done. working: only progress so far, the outcome is still to come.",
    ].join("\n");
    try {
      const raw = await complete(prompt);
      const status = String((JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { status?: unknown }).status ?? "");
      return PROSE_OUTCOMES.has(status as ProseOutcome) ? status as ProseOutcome : null;
    } catch {
      return null;
    }
  };
}
