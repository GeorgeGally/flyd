import { query } from "./llm.js";
import { defaultModel } from "./config.js";
import {
  detectSignal,
  detectEventType,
  extractParticipants,
  extractTopics,
  isValidEventOutcome,
  type EventMetadata,
  type CaptureEventType,
  type EventOutcome,
} from "./schema.js";

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

export function enrichCaptureLocal(body: string): EventMetadata {
  const signal = detectSignal(body) ?? undefined;
  const eventType = detectEventType(body);
  const participants = extractParticipants(body);
  const topics = extractTopics(body);

  return {
    event_type: eventType,
    signal,
    participants: participants.length > 0 ? participants : undefined,
    topics: topics.length > 0 ? topics : undefined,
  };
}

const EVENT_ENRICH_PROMPT = `Analyze this text and extract event metadata. Return ONLY a JSON object:

{
  "signal": "<one of: budget_resistance, budget_available, positive_interest, negative_interest, blocked, launched, pivoted, team_growth, cancelled, positive_feedback, negative_feedback, deal_closed, meeting_scheduled, discovery, decision_made, concern_raised, milestone_reached, progress, delayed, technical_challenge, or null if none>",
  "outcome": "<confirmed | declined | pending | blocked | resolved | achieved | abandoned | null>",
  "participants": ["name1", "name2"],
  "topics": ["topic1", "topic2"],
  "event_type": "<event | observation | decision | belief | goal>"
}

Rules:
- Extract only what is explicitly stated
- Signal must be one of the listed values or null
- Outcome must be one of the listed values or null
- Participants: extract proper names mentioned in the text
- Topics: extract key themes and project names
- event_type: goal = stated objective/aim, decision = concluded choice, event = happened in time, belief = expressed opinion, observation = default`;

export async function enrichCaptureWithLLM(body: string): Promise<EventMetadata> {
  const text = body.slice(0, 2500);
  try {
    const response = await query(`${EVENT_ENRICH_PROMPT}\n\nText:\n${text}`, defaultModel());
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return enrichCaptureLocal(body);

    const parsed = JSON.parse(jsonMatch[0]);

    const result: EventMetadata = {};

    if (typeof parsed.event_type === "string" && ["event", "observation", "decision", "belief", "goal"].includes(parsed.event_type)) {
      result.event_type = parsed.event_type as CaptureEventType;
    } else {
      result.event_type = detectEventType(body);
    }

    if (typeof parsed.signal === "string" && parsed.signal.length > 0) {
      result.signal = parsed.signal;
    }

    if (typeof parsed.outcome === "string" && isValidEventOutcome(parsed.outcome)) {
      result.outcome = parsed.outcome as EventOutcome;
    }

    if (Array.isArray(parsed.participants) && parsed.participants.length > 0) {
      result.participants = parsed.participants.filter((p: unknown) => typeof p === "string" && p.length > 0);
    }

    if (Array.isArray(parsed.topics) && parsed.topics.length > 0) {
      result.topics = parsed.topics.filter((t: unknown) => typeof t === "string" && t.length > 0);
    }

    return result;
  } catch {
    return enrichCaptureLocal(body);
  }
}

export async function enrichBatchWithLLM(
  bodies: Array<{ path: string; body: string }>,
): Promise<Map<string, EventMetadata>> {
  const results = new Map<string, EventMetadata>();

  for (const { path, body } of bodies) {
    const enriched = await enrichCaptureWithLLM(body);
    results.set(path, enriched);
  }

  return results;
}
