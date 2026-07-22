export interface MemoryGateInput {
  intent: string;
  resolutionMode: string;
  outcomeStatus: string | null;
  correction: string | null;
  intentHistory: Array<{ intent: string; timestamp: string }>;
  topicCount: number;
}

export interface MemoryGateResult {
  shouldRemember: boolean;
  reason: string;
  confidence: "low" | "medium" | "high";
  category: "explicit_preference" | "correction" | "repeated_topic" | "teaching" | "confirmation" | "recurring_routine" | "generic_qa";
}

const PREFERENCE_PATTERNS = [
  /always\s/i,
  /never\s/i,
  /prefer\s/i,
  /don't\s.*(show|tell|ask|suggest)/i,
  /keep\s.*(short|brief|concise|detailed|verbose)/i,
  /remember\s/i,
  /from now on/i,
  /going forward/i,
  /stop\s/i,
  /in the style of/i,
];

const CORRECTION_PATTERNS = [
  /no[,\s].*(that'?s?\s+not|wrong|incorrect|bad)/i,
  /actually/i,
  /that'?s?\s+not\s+(right|correct|what\s+i\s+(meant|wanted|asked))/i,
  /fix\s+that/i,
  /try\s+again/i,
  /redo/i,
  /redo\s+that/i,
];

const TEACHING_PATTERNS = [
  /when\s+(i|you)\s+(say|ask|type|do)\b.*(then|always|remember|use)\b/i,
  /if\s+i\s+(say|ask)\b.*(then|respond|answer|do|show)/i,
  /here'?s?\s+how\s+(i|you)\s/i,
  /you\s+should\s+(know|remember|understand)\b/i,
  /my\s+(workflow|process|setup|config)/i,
];

export function memoryGate(input: MemoryGateInput): MemoryGateResult {
  if (input.correction && input.correction.length > 0) {
    return {
      shouldRemember: true,
      reason: "User provided a correction",
      confidence: "high",
      category: "correction",
    };
  }

  for (const pattern of PREFERENCE_PATTERNS) {
    if (pattern.test(input.intent)) {
      return {
        shouldRemember: true,
        reason: `Explicit preference detected: "${input.intent.slice(0, 80)}"`,
        confidence: "high",
        category: "explicit_preference",
      };
    }
  }

  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(input.intent)) {
      return {
        shouldRemember: true,
        reason: `Correction pattern detected: "${input.intent.slice(0, 80)}"`,
        confidence: "high",
        category: "correction",
      };
    }
  }

  for (const pattern of TEACHING_PATTERNS) {
    if (pattern.test(input.intent)) {
      return {
        shouldRemember: true,
        reason: `Multi-step teaching detected: "${input.intent.slice(0, 80)}"`,
        confidence: "medium",
        category: "teaching",
      };
    }
  }

  const similarIntents = input.intentHistory.filter(
    (h) => similarity(h.intent.toLowerCase(), input.intent.toLowerCase()) > 0.6
  );

  if (similarIntents.length >= 2) {
    return {
      shouldRemember: true,
      reason: `Repeated topic (${similarIntents.length} similar intents)`,
      confidence: "high",
      category: "repeated_topic",
    };
  }

  if (input.outcomeStatus === "succeeded" && input.topicCount >= 3) {
    const hoursAgo = input.intentHistory
      .filter((h) => {
        const then = new Date(h.timestamp).getTime();
        const now = Date.now();
        return (now - then) < 24 * 60 * 60 * 1000;
      })
      .length;

    if (hoursAgo >= 2 && hoursAgo % 3 === 0) {
      return {
        shouldRemember: true,
        reason: "Recurring routine detected",
        confidence: "medium",
        category: "recurring_routine",
      };
    }
  }

  if (
    input.intent.length < 30 &&
    /^(what|who|when|where|how|is|are|can|do|does|why)\b/i.test(input.intent)
  ) {
    return {
      shouldRemember: false,
      reason: "Generic Q&A — not significant",
      confidence: "high",
      category: "generic_qa",
    };
  }

  return {
    shouldRemember: false,
    reason: "No significance signal detected",
    confidence: "low",
    category: "generic_qa",
  };
}

function similarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  return intersection / Math.max(wordsA.size, wordsB.size);
}
