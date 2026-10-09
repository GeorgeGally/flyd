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
