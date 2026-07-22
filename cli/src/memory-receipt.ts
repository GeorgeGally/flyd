export interface MemoryReceipt {
  receiptId: string;
  generatedAt: string;
  source: "flyd-overlay";
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
const BELIEF_STORE: BeliefRecord[] = [];
const BEHAVIOUR_STORE: BehaviourRecord[] = [];

export function createMemoryReceipt(
  intent: string,
  resolutionMode: string,
  outcomeStatus: string,
  environmentSummary: string,
  correction: string | null,
  gateReason: string
): MemoryReceipt {
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

  return { beliefs: newBeliefs, behaviours: newBehaviours };
}

export function getBeliefs(): BeliefRecord[] {
  return [...BELIEF_STORE];
}

export function getBehaviours(): BehaviourRecord[] {
  return [...BEHAVIOUR_STORE];
}
