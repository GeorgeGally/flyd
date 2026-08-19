import { query } from "../lib/llm.js";
import { resolveModelConnection } from "../lib/config.js";
import { DOMAIN_STANDARDS } from "../work-intelligence/domain-standards.js";
import { listGoals, listPatterns, addPattern, type CoachPattern } from "./coach-memory.js";
import { listJournalEntries } from "../work-intelligence/outcome-journal.js";
import type { SpecialistContext } from "./specialist-registry.js";

export interface CoachResponderDependencies {
  model?: {
    model: string;
    apiKey: string;
    baseURL?: string;
  };
  queryText?: typeof query;
}

const MIN_GROUNDING = 2;

function recentJournalSummary(): string {
  try {
    const entries = listJournalEntries({ limit: 10 });
    if (entries.length === 0) return "";
    return entries
      .map((e) => `- [${e.eventType}] ${e.details ? JSON.stringify(e.details).slice(0, 200) : ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

function patternsSummary(patterns: CoachPattern[]): string {
  if (patterns.length === 0) return "";
  return patterns
    .map((p) => `- [${p.epistemicStatus}] ${p.observation}`)
    .join("\n");
}

function buildGrounding(context: SpecialistContext): string {
  const goals = listGoals();
  const patterns = listPatterns();
  const journal = recentJournalSummary();
  const present = context.presentHypothesis ? `- Present: ${context.presentHypothesis}` : "";

  return [
    goals.length ? `Goals:\n${goals.map((g) => `- ${g.statement}`).join("\n")}` : "",
    patterns.length ? `Known patterns:\n${patternsSummary(patterns)}` : "",
    journal ? `Recent journal:\n${journal}` : "",
    present,
    context.situation?.project ? `- Current project: ${context.situation.project}` : "",
  ].filter(Boolean).join("\n\n");
}

function groundingCount(context: SpecialistContext): number {
  let count = 0;
  if (listGoals().length > 0) count++;
  if (listPatterns().length > 0) count++;
  if (recentJournalSummary() !== "") count++;
  if (context.presentHypothesis) count++;
  return count;
}

export function coachSpecialist(respond: CoachResponderDependencies = {}): {
  name: string;
  domain: string;
  dispatch(input: SpecialistContext): Promise<string | null>;
} {
  return {
    name: "coach",
    domain: "coach",
    async dispatch(context: SpecialistContext): Promise<string | null> {
      const grounding = buildGrounding(context);
      if (groundingCount(context) < MIN_GROUNDING) {
        return "I need more grounding before I can coach you usefully. Tell me a current goal, or do a quick check-in (mood, focus, priorities, blockers), and I'll work from real data instead of generic advice.";
      }

      const connection = respond.model ?? resolveModelConnection();
      const standard = DOMAIN_STANDARDS.coach;
      const system = [
        "You are George's coach — a distillation of the world's best wellness, business, and life coaches.",
        "You never give generic advice. Every intervention is grounded in the user's actual goals, journal, check-ins, and known patterns.",
        `Evaluation dimensions: ${standard.evaluationDimensions.join("; ")}`,
        `Avoidances: ${standard.avoidances.join("; ")}`,
        "Diagnose the ONE causal issue. Propose ONE high-leverage intervention. Be direct and specific.",
      ].join(" ");

      const prompt = `User message: ${context.message}\n\nKnown about George:\n${grounding}\n\nCoach:`;

      const reply = await (respond.queryText ?? query)(
        prompt,
        connection.model,
        system,
        connection.apiKey,
        connection.baseURL,
      );

      return reply.trim();
    },
  };
}
