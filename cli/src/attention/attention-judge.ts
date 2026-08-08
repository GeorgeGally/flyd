import type {
  CandidateEvent,
  AttentionDecision,
  Disposition,
  ReasonCode,
  EvidenceRef,
  Commitment,
} from "./types.js";
import { ATTENTION_JUDGE_MODEL, ATTENTION_JUDGE_TIMEOUT_MS } from "./config.js";

export interface JudgeContext {
  candidate: CandidateEvent;
  relatedCommitments: Commitment[];
  attentionState: { interactionMode: string; foregroundContext?: { id: string; kind: string; label: string } };
  allowedDispositions: Disposition[];
  policyConstraints: { maxDisposition: Disposition; reasonCodes: ReasonCode[] };
  deterministicScore: number;
  deterministicDisposition: Disposition;
}

export interface JudgeResult {
  disposition: Disposition;
  reasonCodes: ReasonCode[];
  confidence: number;
  evidenceSummary: string;
  reasoning: string;
}

const JUDGE_SYSTEM_PROMPT =
  "You are Flyd's attention judge. Your role is to make bounded, evidence-backed decisions about whether a candidate event deserves the user's attention. You must NOT invent evidence, propose unknown actions, or exceed your allowed dispositions. Output ONLY valid JSON.";

function buildJudgePrompt(ctx: JudgeContext): string {
  const c = ctx.candidate;
  const commitments = ctx.relatedCommitments
    .map((comm) => `- [${comm.status}] ${comm.title} (confidence: ${comm.confidence.toFixed(2)})`)
    .join("\n");

  return `You are evaluating a candidate event for Flyd's attention engine. Make a disposition decision.

CANDIDATE:
  Type: ${c.type}
  Subject: ${c.subject.label} (${c.subject.kind})
  Commitment: ${commitments || "none"}
  Urgency: ${c.urgency.toFixed(2)}
  Consequence: ${c.consequence.toFixed(2)}
  User Relevance: ${c.userRelevance.toFixed(2)}
  Novelty: ${c.novelty.toFixed(2)}
  Evidence Quality: ${c.evidenceQuality.toFixed(2)}
  Interruption Cost: ${c.interruptionCost.toFixed(2)}
  Reversibility: ${c.reversibility.toFixed(2)}
  Confidence: ${c.confidence.toFixed(2)}
  Signal Count: ${c.signalIds.length}
  First Seen: ${c.firstSeenAt}
  Last Seen: ${c.lastSeenAt}

CONTEXT:
  Interaction Mode: ${ctx.attentionState.interactionMode}
  Deterministic Score: ${ctx.deterministicScore.toFixed(2)}
  Deterministic Disposition: ${ctx.deterministicDisposition}

ALLOWED DISPOSITIONS: ${ctx.allowedDispositions.join(", ")}
MAX DISPOSITION: ${ctx.policyConstraints.maxDisposition}

RULES:
1. You MUST return one of the allowed dispositions.
2. You must not exceed the max disposition from policy constraints.
3. Provide concrete reason codes based on evidence.
4. Confidence must be between 0 and 1. It must not exceed the candidate's confidence.
5. Never propose a disposition that exceeds the maxDisposition.
6. If the deterministic disposition and your judgment differ by more than one band, choose the more conservative option.
7. Conflict/contradiction in evidence must reduce confidence.
8. Prefer remember over ignore; prefer next_scene over notify_now when in doubt.

Return ONLY a JSON object:
{
  "disposition": "next_scene",
  "reasonCodes": ["DUE_SOON", "HIGH_CONSEQUENCE"],
  "confidence": 0.75,
  "evidenceSummary": "one sentence summary",
  "reasoning": "brief explanation of the decision"
}`;
}

export function requiresModelJudgment(ctx: JudgeContext): boolean {
  const c = ctx.candidate;

  if (ctx.allowedDispositions.length <= 1) return false;

  const scoreGap = Math.abs(ctx.deterministicScore - 0.5);
  if (scoreGap > 0.15) return false;

  if (c.consequence > 0.7) return true;

  if (c.type === "explicit_reminder" || c.type === "deadline_due") return false;

  if (c.confidence < 0.4 || c.confidence > 0.8) return false;

  return false;
}

export class AttentionJudge {
  async evaluate(ctx: JudgeContext): Promise<AttentionDecision> {
    if (!requiresModelJudgment(ctx)) {
      return this.deterministicFallback(ctx);
    }

    try {
      const prompt = buildJudgePrompt(ctx);
      const model = ATTENTION_JUDGE_MODEL;
      const apiKey = process.env.FLYD_MODEL_API_KEY;
      const baseURL = process.env.FLYD_MODEL_BASE_URL;

      if (!model || !apiKey) return this.deterministicFallback(ctx);

      const { query } = await import("../lib/llm.js");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ATTENTION_JUDGE_TIMEOUT_MS);
      const response = await query(prompt, model, JUDGE_SYSTEM_PROMPT, apiKey, baseURL);
      clearTimeout(timeout);

      const parsed = parseJudgeResponse(response);
      if (!parsed) return this.deterministicFallback(ctx);

      const allowedDisps = new Set(ctx.allowedDispositions);
      if (!allowedDisps.has(parsed.disposition)) {
        return this.deterministicFallback(ctx);
      }

      const maxDispositionIdx = DISPOSITION_RANK.indexOf(ctx.policyConstraints.maxDisposition);
      const proposedIdx = DISPOSITION_RANK.indexOf(parsed.disposition);
      if (proposedIdx > maxDispositionIdx) {
        parsed.disposition = ctx.policyConstraints.maxDisposition;
      }

      return {
        candidateId: ctx.candidate.id,
        disposition: parsed.disposition,
        reasonCodes: parsed.reasonCodes,
        evidence: [],
        confidence: Math.min(parsed.confidence, ctx.candidate.confidence),
        policyVersion: "judge-v1",
        decidedAt: new Date().toISOString(),
      };
    } catch {
      return this.deterministicFallback(ctx);
    }
  }

  deterministicFallback(ctx: JudgeContext): AttentionDecision {
    return {
      candidateId: ctx.candidate.id,
      disposition: ctx.deterministicDisposition,
      reasonCodes: [...ctx.policyConstraints.reasonCodes],
      evidence: [],
      confidence: Math.min(0.5, ctx.candidate.confidence),
      policyVersion: "deterministic-fallback",
      decidedAt: new Date().toISOString(),
    };
  }
}

const DISPOSITION_RANK: Disposition[] = ["ignore", "remember", "prepare", "next_scene", "notify_now", "ask_permission", "act"];

interface ParsedJudgeResponse {
  disposition: Disposition;
  reasonCodes: ReasonCode[];
  confidence: number;
  evidenceSummary: string;
  reasoning: string;
}

function parseJudgeResponse(raw: string): ParsedJudgeResponse | null {
  try {
    let jsonStr = raw.trim();
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];

    const parsed = JSON.parse(jsonStr);
    const disposition = String(parsed.disposition).trim() as Disposition;
    const validDisp = DISPOSITION_RANK.includes(disposition);
    if (!validDisp) return null;

    return {
      disposition,
      reasonCodes: Array.isArray(parsed.reasonCodes) ? parsed.reasonCodes : [],
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      evidenceSummary: String(parsed.evidenceSummary ?? ""),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return null;
  }
}

export const attentionJudge = new AttentionJudge();
