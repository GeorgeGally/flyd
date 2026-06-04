import { query } from "./llm.js";
import { defaultModel } from "./config.js";

export interface EntityTriple {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface EntityMention {
  entity: string;
  type: "person" | "technology" | "concept" | "project" | "tool" | "organization";
  mentions: number;
}

const EXTRACTION_PROMPT = `Extract knowledge triples and entity mentions from this text.

For triples, use format: subject | predicate | object
Example: "flyd uses qmd SDK" → flyd | uses | qmd SDK
Example: "the graph module stores entities as JSON" → graph module | stores | entities as JSON

For entity mentions, classify each entity into one type.

Rules:
- Only extract factual claims explicitly stated in the text
- Skip vague statements, opinions, and conversational filler
- Prefer specific entities over generic ones ("TypeScript" not "language")
- Max 10 triples and 10 entities per text block
- confidence: 0.0-1.0 based on how directly the text states this

Respond ONLY with a JSON object:
{
  "triples": [{ "subject": "...", "predicate": "...", "object": "...", "confidence": 0.9 }],
  "entities": [{ "entity": "...", "type": "...", "mentions": 1 }]
}`;

export async function extractEntities(body: string): Promise<{ triples: EntityTriple[]; entities: EntityMention[] }> {
  const bodyTrimmed = body.trim();
  if (bodyTrimmed.length < 100) {
    return { triples: [], entities: [] };
  }

  const text = bodyTrimmed.slice(0, 2000);

  try {
    const response = await query(`${EXTRACTION_PROMPT}\n\nText:\n${text}`, defaultModel());
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { triples: [], entities: [] };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      triples: Array.isArray(parsed.triples) ? parsed.triples : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    };
  } catch {
    return { triples: [], entities: [] };
  }
}

export async function extractEntitiesBatch(
  bodies: Array<{ path: string; body: string }>,
): Promise<Map<string, { triples: EntityTriple[]; entities: EntityMention[] }>> {
  const results = new Map<string, { triples: EntityTriple[]; entities: EntityMention[] }>();

  for (const { path, body } of bodies) {
    const extracted = await extractEntities(body);
    results.set(path, extracted);
  }

  return results;
}
