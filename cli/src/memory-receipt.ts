import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { extractKeywords } from "./lib/retrieval.js";
import { parse as parseFrontmatter } from "./lib/frontmatter.js";

export interface MemoryReceipt {
  receiptId: string;
  generatedAt: string;
  source: "flyd-overlay" | "flyd-work-intelligence";
  belief: {
    what: string;
    why: string;
    when: string;
  };
  evidence: {
    intent: string;
    resolution: string;
    outcome: string;
    environmentSummary: string;
    correction: string | null;
  };
  selfContained: boolean;
  eventType: string;
  derivedSignal: string;
  topics: string[];
}

export interface LearningReceipt {
  receiptId: string;
  generatedAt: string;
  source: "flyd-work-intelligence";
  provenance: {
    epistemicConfidence: 'high' | 'medium' | 'low';
    sourceType: string;
    domain: string;
    outcomeRef: string;
    timestamp: string;
  };
  belief: {
    what: string;
    why: string;
    when: string;
  };
  evidence: {
    content: string;
    domain: string;
    outcomeRef: string;
  };
  selfContained: boolean;
  eventType: string;
  derivedSignal: string;
  topics: string[];
}

export interface ProvisionalLearning {
  learningId: string;
  domain: string;
  value: unknown;
  acknowledged: boolean;
  synthesizedAt: string | null;
}

interface BeliefRecord {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  firstObserved: string;
  lastUpdated: string;
  observationCount: number;
  contradictoryCount: number;
}

interface BehaviourRecord {
  id: string;
  pattern: string;
  response: string;
  context: string;
  confidence: number;
  firstObserved: string;
  lastUsed: string;
  useCount: number;
}

const PROVISIONAL_STORE: ProvisionalLearning[] = [];
let BELIEF_STORE: BeliefRecord[] = [];
let BEHAVIOUR_STORE: BehaviourRecord[] = [];

export function createMemoryReceipt(
  intent: string,
  resolutionMode: string,
  outcomeStatus: string,
  environmentSummary: string,
  correction: string | null,
  gateReason: string,
  gateCategory: string
): MemoryReceipt {
  const topics = extractKeywords(intent);
  return {
    receiptId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    source: "flyd-overlay",
    belief: {
      what: gateReason,
      why: `User invoked with intent: "${intent.slice(0, 100)}" → resolved as ${resolutionMode} → outcome: ${outcomeStatus}`,
      when: new Date().toISOString(),
    },
    evidence: {
      intent: intent.slice(0, 200),
      resolution: resolutionMode,
      outcome: outcomeStatus,
      environmentSummary,
      correction,
    },
    selfContained: true,
    eventType: gateCategory,
    derivedSignal: gateCategoryToSignal(gateCategory),
    topics,
  };
}

function gateCategoryToSignal(category: string): string {
  const map: Record<string, string> = {
    explicit_preference: "preference",
    correction: "correction_feedback",
    repeated_topic: "recurring_interest",
    teaching: "workflow_defined",
    recurring_routine: "routine_detected",
    confirmation: "confirmed",
  };
  return map[category] ?? "observation";
}

export interface LearningCandidateInput {
  id: string;
  source: string;
  content: string;
  domain: string;
  outcomeRef: string;
  epistemicConfidence: 'high' | 'medium' | 'low';
  timestamp: string;
}

export function createLearningReceipt(
  candidate: LearningCandidateInput,
  source: string,
  domain: string
): LearningReceipt {
  const topics = extractKeywords(candidate.content);
  return {
    receiptId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    source: "flyd-work-intelligence",
    provenance: {
      epistemicConfidence: candidate.epistemicConfidence,
      sourceType: candidate.source,
      domain: candidate.domain || domain,
      outcomeRef: candidate.outcomeRef,
      timestamp: candidate.timestamp,
    },
    belief: {
      what: source,
      why: `Learning from ${candidate.source}: "${candidate.content.slice(0, 120)}"`,
      when: candidate.timestamp,
    },
    evidence: {
      content: candidate.content.slice(0, 200),
      domain: candidate.domain || domain,
      outcomeRef: candidate.outcomeRef,
    },
    selfContained: true,
    eventType: `wt_${candidate.source}`,
    derivedSignal: candidate.source,
    topics,
  };
}

export function provisionalLearn(intent: string): ProvisionalLearning | null {
  const verbosity = intent.match(/(keep|make)\s+(answers?|responses?)\s+(short|concise|brief)/i);
  if (verbosity) {
    const learning: ProvisionalLearning = {
      learningId: crypto.randomUUID(),
      domain: "response_verbosity",
      value: "concise",
      acknowledged: false,
      synthesizedAt: null,
    };
    PROVISIONAL_STORE.push(learning);
    return learning;
  }

  const style = intent.match(/(use|write\s+in|in\s+the)\s+(style|voice|tone)\s+of\s+(.+)/i);
  if (style) {
    const learning: ProvisionalLearning = {
      learningId: crypto.randomUUID(),
      domain: "response_style",
      value: style[3].trim(),
      acknowledged: false,
      synthesizedAt: null,
    };
    PROVISIONAL_STORE.push(learning);
    return learning;
  }

  const format = intent.match(/(show|format|display)\s+(as|in)\s+(bullet|list|table|json|code)/i);
  if (format) {
    const learning: ProvisionalLearning = {
      learningId: crypto.randomUUID(),
      domain: "response_format",
      value: format[3].toLowerCase(),
      acknowledged: false,
      synthesizedAt: null,
    };
    PROVISIONAL_STORE.push(learning);
    return learning;
  }

  return null;
}

export function acknowledgeLearning(learningId: string): boolean {
  const learning = PROVISIONAL_STORE.find((l) => l.learningId === learningId);
  if (learning) {
    learning.acknowledged = true;
    return true;
  }
  return false;
}

export function getPendingLearnings(): ProvisionalLearning[] {
  return PROVISIONAL_STORE.filter((l) => !l.acknowledged);
}

export function synthesizeLearnings(): { beliefs: BeliefRecord[]; behaviours: BehaviourRecord[] } {
  const newBeliefs: BeliefRecord[] = [];
  const newBehaviours: BehaviourRecord[] = [];

  for (const learning of PROVISIONAL_STORE) {
    if (!learning.synthesizedAt) {
      learning.synthesizedAt = new Date().toISOString();

      const existingBelief = BELIEF_STORE.find(
        (b) => b.subject === learning.domain && b.object === String(learning.value)
      );

      if (existingBelief) {
        existingBelief.observationCount++;
        existingBelief.lastUpdated = new Date().toISOString();
        existingBelief.confidence = Math.min(existingBelief.confidence + 0.05, 1.0);
      } else {
        const belief: BeliefRecord = {
          id: crypto.randomUUID(),
          subject: learning.domain,
          predicate: "has_value",
          object: String(learning.value),
          confidence: 0.8,
          source: "flyd-overlay",
          firstObserved: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          observationCount: 1,
          contradictoryCount: 0,
        };
        BELIEF_STORE.push(belief);
        newBeliefs.push(belief);
      }

      const existingBehaviour = BEHAVIOUR_STORE.find(
        (b) => b.pattern === learning.domain && b.response === String(learning.value)
      );

      if (existingBehaviour) {
        existingBehaviour.useCount++;
        existingBehaviour.lastUsed = new Date().toISOString();
        existingBehaviour.confidence = Math.min(existingBehaviour.confidence + 0.03, 1.0);
      } else {
        const behaviour: BehaviourRecord = {
          id: crypto.randomUUID(),
          pattern: learning.domain,
          response: String(learning.value),
          context: "overlay_invocation",
          confidence: 0.7,
          firstObserved: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          useCount: 1,
        };
        BEHAVIOUR_STORE.push(behaviour);
        newBehaviours.push(behaviour);
      }
    }
  }

  return { beliefs: newBeliefs, behaviours: newBehaviours };
}

export function loadLearnings(): { beliefs: number; behaviours: number } {
  const OVERLAY_DIR = join(homedir(), ".flyd", "raw", "overlay");
  if (!existsSync(OVERLAY_DIR)) return { beliefs: 0, behaviours: 0 };

  const beliefRecords: BeliefRecord[] = [];
  const behaviourRecords: BehaviourRecord[] = [];

  for (const entry of readdirSync(OVERLAY_DIR)) {
    if (!entry.startsWith("synthesis-") || !entry.endsWith(".md")) continue;
    const filepath = join(OVERLAY_DIR, entry);
    const raw = readFileSync(filepath, "utf-8");
    const fm = parseFrontmatter(raw);
    const timestampValue = fm.metadata.timestamp ?? fm.metadata.generated_at;
    const timestamp = timestampValue == null ? "" : String(timestampValue);

    const beliefsSection = raw.indexOf("## Synthesized Beliefs");
    const behavioursSection = raw.indexOf("## Synthesized Behaviours");
    if (beliefsSection < 0) continue;

    const sectionEnd = behavioursSection > beliefsSection ? behavioursSection : raw.length;
    const beliefBlock = raw.slice(beliefsSection, sectionEnd);

    for (const line of beliefBlock.split("\n")) {
      const m = line.match(/Subject:\*\* (.+?),.*Predicate:\*\* (.+?),.*Object:\*\* (.+?),.*Confidence:\*\* ([\d.]+)/);
      if (m) {
        const existing = beliefRecords.find(b => b.subject === m[1] && b.object === m[3]);
        if (existing) {
          existing.confidence = Math.max(existing.confidence, parseFloat(m[4]));
          existing.observationCount++;
        } else {
          beliefRecords.push({
            id: crypto.randomUUID(),
            subject: m[1].trim(),
            predicate: m[2].trim(),
            object: m[3].trim(),
            confidence: parseFloat(m[4]),
            source: "flyd-overlay",
            firstObserved: timestamp,
            lastUpdated: timestamp,
            observationCount: 1,
            contradictoryCount: 0,
          });
        }
      }
    }

    if (behavioursSection > 0) {
      const behaviourBlock = raw.slice(behavioursSection);
      for (const line of behaviourBlock.split("\n")) {
        const m = line.match(/Pattern:\*\* (.+?),.*Response:\*\* (.+?),.*Context:\*\* (.+?),.*Confidence:\*\* ([\d.]+)/);
        if (m) {
          const existing = behaviourRecords.find(b => b.pattern === m[1] && b.response === m[2]);
          if (existing) {
            existing.confidence = Math.max(existing.confidence, parseFloat(m[4]));
            existing.useCount++;
          } else {
            behaviourRecords.push({
              id: crypto.randomUUID(),
              pattern: m[1].trim(),
              response: m[2].trim(),
              context: m[3].trim(),
              confidence: parseFloat(m[4]),
              firstObserved: timestamp,
              lastUsed: timestamp,
              useCount: 1,
            });
          }
        }
      }
    }
  }

  BELIEF_STORE = beliefRecords;
  BEHAVIOUR_STORE = behaviourRecords;
  return { beliefs: beliefRecords.length, behaviours: behaviourRecords.length };
}

export function getBeliefs(): BeliefRecord[] {
  return [...BELIEF_STORE];
}

export function getBehaviours(): BehaviourRecord[] {
  return [...BEHAVIOUR_STORE];
}
