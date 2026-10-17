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

export function parseDomainResult(body: string): { status?: "completed" | "needs_decision" | "failed"; result: DomainResult } {
  const raw = body.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const brief = String(parsed.brief ?? "").trim();
      const detailedReport = String(parsed.detailed_report ?? parsed.detailedReport ?? "").trim();
      if (brief || detailedReport) {
        const riskRaw = String(parsed.information_loss_risk ?? parsed.informationLossRisk ?? "low");
        const risk: InformationLossRisk = riskRaw === "high" || riskRaw === "medium" ? riskRaw : "low";
        const statusRaw = String(parsed.status ?? "").trim();
        const status = statusRaw === "needs_decision" || statusRaw === "failed" || statusRaw === "completed"
          ? statusRaw
          : undefined;
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
    } catch {
      // The durable raw reply still survives below.
    }
  }

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

/**
 * The layered handoff contract a domain boss must meet before Flyd records its
 * work as done: a brief, a report body, and at least one evidence reference.
 * Prose with no layers meets none of them, even though Flyd derives a brief and
 * report from it so the raw detail survives.
 */
export function validateDomainHandoff(result: DomainResult): HandoffValidation {
  const structured = result.format === "structured";
  const missing: HandoffLayer[] = [];
  if (!structured || !result.brief.trim()) missing.push("brief");
  if (!structured || !result.detailedReport.trim()) missing.push("report");
  if (!result.evidence.some((item) => item.trim())) missing.push("evidence");
  return missing.length
    ? { ok: false, missing, reason: `domain handoff contract unmet: missing ${missing.join(", ")}` }
    : { ok: true };
}

/** How a reply written in plain prose left the work: the staff often answers that way instead of the JSON contract. */
export type ProseOutcome = "completed" | "needs_decision" | "failed" | "working";

/** Reads a prose reply's outcome, e.g. with Flyd's model; null when it cannot tell. */
export type ProseJudge = (reply: string, intendedOutcome: string) => Promise<ProseOutcome | null>;

const PROSE_OUTCOMES = new Set<ProseOutcome>(["completed", "needs_decision", "failed", "working"]);

const STATED = /\bstatus\s*[=:]\s*(completed|needs_decision|failed|working)\b/i;
const ASKS_HIM = /\?\s*$|\b((your|his|george['’]s) (call|decision|approval|go-ahead)|do you want|would you like|shall i|should i|want me to|needs? (you|your|him|george)|waiting (on|for) (you|your|him|george)|(please|can you|could you) (approve|confirm|decide))\b/i;
const FAILED = /\b(failed|couldn['’]t|could not|can['’]t|cannot|unable to|blocked|broke|gave up)\b/i;
const IN_PROGRESS = /^(on it|working on|picked (it|this) up|started|starting|in progress|queued|will (report|update|follow up))\b/i;

/** The fallback when no model can read the reply: plain words, judged conservatively. */
export function proseOutcomeByWords(reply: string): ProseOutcome {
  const text = reply.replace(/^captain[,:!.]?\s+/i, "").trim();
  const stated = text.match(STATED)?.[1]?.toLowerCase();
  if (stated) return stated as ProseOutcome;
  if (ASKS_HIM.test(text)) return "needs_decision";
  if (FAILED.test(text)) return "failed";
  if (IN_PROGRESS.test(text)) return "working";
  return "completed";
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
