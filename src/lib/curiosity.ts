import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { WIKI_DIR, defaultModel } from "./config.js";
import { query } from "./llm.js";
import { computeAttention, loadCaptureDocs, type AttentionSignal } from "./attention.js";
import { loadGoals, computeTension, type TensionScore } from "./tension.js";

export interface CuriosityQuestion {
  id: string;
  question: string;
  generatedAt: string;
  source: "attention" | "tension" | "decay" | "pattern";
  investigated: boolean;
  findings?: string;
  missingEvidence?: string;
  relevantPages?: string[];
}

const QUESTION_PROMPT = `You are an AI analyzing the user's personal memory system (flyd). You have access to:
1. Attention signals: topics ranked by activity, velocity, unresolved issues, surprises
2. Tension scores: active goals vs reality

Generate 3-5 insightful questions about the user's work that reveal patterns, tensions, or opportunities. 

Rules:
- Be specific. Reference actual topics and goals by name.
- Focus on meaningful patterns: declining activity, unresolved blockers, contradictions, emerging focus shifts.
- Avoid generic questions. Each question should be answerable from the user's captured history.
- Keep questions under 100 chars.

Format: Return ONLY a JSON array of question strings:
["question 1", "question 2", "question 3"]

Attention signals:
{attentionContext}

Tension scores:
{tensionContext}`;

const INVESTIGATE_PROMPT = `You are investigating a question using evidence from a personal memory system. Use the provided evidence to:

1. Answer the question if possible
2. Identify what's missing if you cannot fully answer
3. Note any patterns or tensions revealed

Question: {question}

Evidence:
{evidence}

Respond with JSON:
{
  "findings": "concise summary of what you found (1-3 sentences)",
  "missingEvidence": "what information would be needed to fully answer (or null if answered)",
  "insight": "any pattern or tension revealed (or null if none)"
}`;

export function generateContextForQuestions(
  attention: AttentionSignal[],
  tension: TensionScore[],
): { attentionContext: string; tensionContext: string } {
  const attentionContext = attention
    .slice(0, 10)
    .map((s) => {
      const parts = [`  - ${s.topic}: ${(s.composite * 100).toFixed(0)}% attention`];
      if (s.velocity > 0) parts.push(`velocity: ${s.velocity}`);
      if (s.unresolved > 0) parts.push(`unresolved: ${s.unresolved}`);
      if (s.surprise > 0) parts.push(`surprise: ${s.surprise}`);
      if (s.details.recentCaptures > 0) parts.push(`recent: ${s.details.recentCaptures}`);
      parts.push(`total: ${s.details.totalCount}`);
      return parts.join(", ");
    })
    .join("\n");

  const tensionContext = tension
    .filter((t) => t.goal.status === "active")
    .map((t) => {
      return `  - ${t.goal.title}: ${(t.tension * 100).toFixed(0)}% tension, ${t.recentActivity} recent events, ${t.blockers} blockers${t.goal.deadline ? `, deadline: ${t.goal.deadline}` : ""}`;
    })
    .join("\n");

  return {
    attentionContext: attentionContext || "  (no attention signals)",
    tensionContext: tensionContext || "  (no active goals)",
  };
}

export async function generateQuestions(
  attention: AttentionSignal[],
  tension: TensionScore[],
): Promise<string[]> {
  const { attentionContext, tensionContext } = generateContextForQuestions(attention, tension);

  const prompt = QUESTION_PROMPT
    .replace("{attentionContext}", attentionContext)
    .replace("{tensionContext}", tensionContext);

  try {
    const response = await query(prompt, defaultModel());
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((q: unknown) => typeof q === "string" && q.length > 10).slice(0, 5);
      }
    }
  } catch {}

  return [];
}

export async function investigateQuestion(
  question: string,
  docs: Array<{ path: string; body: string }>,
): Promise<{ findings: string; missingEvidence: string | null; insight: string | null }> {
  const evidence = docs
    .map((d) => `[${d.path}]: ${d.body.slice(0, 800)}`)
    .join("\n\n---\n\n")
    .slice(0, 4000);

  const prompt = INVESTIGATE_PROMPT
    .replace("{question}", question)
    .replace("{evidence}", evidence);

  try {
    const response = await query(prompt, defaultModel());
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        findings: parsed.findings ?? "No findings available.",
        missingEvidence: parsed.missingEvidence ?? null,
        insight: parsed.insight ?? null,
      };
    }
  } catch {}

  return {
    findings: "Investigation failed — could not parse response.",
    missingEvidence: "LLM call failed",
    insight: null,
  };
}

export function getRelevantDocsForQuestion(
  question: string,
  allDocs: Array<{ path: string; body: string; topics: string[] }>,
): Array<{ path: string; body: string }> {
  const questionLower = question.toLowerCase();
  const scored = allDocs.map((d) => {
    let score = 0;
    for (const topic of d.topics) {
      if (questionLower.includes(topic)) score += 3;
    }
    const words = questionLower.split(/\s+/).filter((w) => w.length > 3);
    for (const w of words) {
      if (d.body.toLowerCase().includes(w)) score += 1;
    }
    return { ...d, score };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ path, body }) => ({ path, body }));
}

export function writeCuriosityLog(
  questions: CuriosityQuestion[],
): void {
  if (!existsSync(WIKI_DIR)) return;

  const logPath = join(WIKI_DIR, "curiosity-log.md");
  const today = new Date().toISOString().split("T")[0];

  let content = existsSync(logPath) ? readFileSync(logPath, "utf8") : "# Curiosity Log\n\n";

  if (content.includes(`## ${today}`)) return;

  content += `\n## ${today}\n\n`;

  for (const q of questions) {
    content += `### Q: ${q.question}\n`;
    content += `**Source:** ${q.source} | **Generated:** ${q.generatedAt}\n\n`;
    if (q.findings) {
      content += `**Findings:** ${q.findings}\n\n`;
    }
    if (q.missingEvidence) {
      content += `**Missing:** ${q.missingEvidence}\n\n`;
    }
    if (q.relevantPages?.length) {
      content += `**Evidence:** ${q.relevantPages.join(", ")}\n\n`;
    }
  }

  mkdirSync(WIKI_DIR, { recursive: true });
  writeFileSync(logPath, content, "utf8");
}
