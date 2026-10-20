import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { EpisodicMemory } from "../../intelligence/episodes/service.js";
import { query } from "../../lib/llm.js";
import { FLYD_DIR } from "../../lib/config.js";
import type { EpisodeEvalCase } from "./types.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseCase(text: string): Omit<EpisodeEvalCase, "id" | "createdAt" | "evidenceSequences" | "snapshotHeadSequence"> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<EpisodeEvalCase>;
    const allowed = new Set(["what_happened", "evolution", "decision", "change", "historical_state"]);
    if (!parsed.question?.trim() || !parsed.goldAnswer?.trim() || !parsed.rubric?.trim() || !allowed.has(String(parsed.category))) return null;
    return {
      category: parsed.category as EpisodeEvalCase["category"],
      question: parsed.question.trim(),
      goldAnswer: parsed.goldAnswer.trim(),
      rubric: parsed.rubric.trim(),
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const count = Math.max(4, Math.min(30, Number(argValue("--count") ?? 12)));
  const model = argValue("--model");
  const memory = new EpisodicMemory();
  memory.rebuild();
  const store = new IntelligenceEventStore();
  const snapshotHeadSequence = store.headSequence();
  const snapshotHeadSequence = store.headSequence();
  const allEvents = store.readFrom(0, Number.MAX_SAFE_INTEGER).filter((event) => !event.erased && event.payload);
  store.close();
  if (allEvents.length < 8) throw new Error("Not enough canonical events to seed an episodic benchmark");

  const nodes = memory.timeline(Math.max(count * 3, 24))
    .filter((node) => node.eventCount >= 2)
    .sort((a, b) => b.eventCount - a.eventCount || b.endSequence - a.endSequence);
  const selected = nodes.slice(0, count);
  const cases: EpisodeEvalCase[] = [];

  for (let index = 0; index < selected.length; index += 1) {
    const node = selected[index]!;
    const events = allEvents
      .filter((event) => event.sequence >= node.startSequence && event.sequence <= node.endSequence)
      .slice(-32);
    if (events.length < 2) continue;
    const evidence = events.map((event) =>
      `[event:${event.sequence}; ${event.capturedAt}; ${event.kind}; ${event.sourceId}] ${JSON.stringify(event.payload)}`
    ).join("\n");
    const prompt = [
      "Create ONE hard but fair historical-memory benchmark question for Flyd, George's personal AI.",
      "Use only the evidence below. The question should require recalling an evolution, decision, change, historical state, or what happened—not a trivial string lookup.",
      "Prefer stable past-tense questions. Do not ask what is current/latest now, because this corpus may be rerun after new events are added.",
      "Prefer stable past-tense questions. Do not ask what is current/latest now, because this corpus may be rerun after new events are added.",
      "Do not mention event ids, internal schemas, source ids, or that this is an eval.",
      "The gold answer must be concise, factual, and answerable solely from the evidence.",
      "The rubric should state the specific facts and temporal distinctions required for a 9/10 answer.",
      'Return JSON only: {"category":"what_happened|evolution|decision|change|historical_state","question":"...","goldAnswer":"...","rubric":"..."}',
      "",
      evidence,
    ].join("\n");
    const generated = parseCase(await query(prompt, model, undefined, undefined, undefined, { json: true, source: "episode-eval-seed" }));
    if (!generated) continue;
    cases.push({
      id: `history-${String(cases.length + 1).padStart(2, "0")}`,
      ...generated,
      evidenceSequences: events.map((event) => event.sequence),
      createdAt: new Date().toISOString(),
      snapshotHeadSequence,
    });
  }

  if (cases.length < 4) throw new Error(`Only generated ${cases.length} valid cases; need at least 4`);
  const directory = join(FLYD_DIR, "evals", "episodes");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "cases.json");
  writeFileSync(path, JSON.stringify(cases, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Seeded ${cases.length} frozen episodic-memory cases from canonical history: ${path}\n`);
}

main().catch((error) => {
  process.stderr.write(`episode eval seed failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
