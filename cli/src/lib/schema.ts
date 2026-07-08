export type CaptureEventType = "event" | "observation" | "decision" | "belief" | "goal";
export type EventOutcome = "confirmed" | "declined" | "pending" | "blocked" | "resolved" | "achieved" | "abandoned";

export interface EventMetadata {
  event_type?: CaptureEventType;
  signal?: string;
  confidence?: number;
  participants?: string[];
  outcome?: EventOutcome;
  topics?: string[];
}

const VALID_EVENT_TYPES = new Set<string>(["event", "observation", "decision", "belief", "goal"]);
const VALID_OUTCOMES = new Set<string>(["confirmed", "declined", "pending", "blocked", "resolved", "achieved", "abandoned"]);

const SIGNAL_PATTERNS: Array<{ regex: RegExp; signal: string }> = [
  { regex: /\b(?:budget|money|cost|price|expensive|cheap|funding)\b.*\b(?:resistance|issue|problems?|concerns?|constraint|tight|worr(?:y|ied)|challenge)\b/i, signal: "budget_resistance" },
  { regex: /\b(?:budget|funding|money)\b.*\b(?:approved|available|flexible|open|secured|committed|ready|go)\b/i, signal: "budget_available" },
  { regex: /\b(?:interested|interest|intrigued|excited|enthusiastic|keen|on board|sold|loved|liked)\b/i, signal: "positive_interest" },
  { regex: /\b(?:not interested|not a fit|passing|passed|decline|no thanks|not for us|not right|wasn['']t interested)\b/i, signal: "negative_interest" },
  { regex: /\b(?:blocked|blocker|stuck|roadblock|obstacle|cant proceed|can['']t proceed|halted|stopped|on hold)\b/i, signal: "blocked" },
  { regex: /\b(?:launched|shipped|released|deployed|published|went live|now live|rolled out)\b/i, signal: "launched" },
  { regex: /\b(?:pivot|pivoted|changing direction|new direction|change course|different approach|rethink)\b/i, signal: "pivoted" },
  { regex: /\b(?:hired|onboarded|joined|new team member|brought on|new hire)\b/i, signal: "team_growth" },
  { regex: /\b(?:cancelled|canceled|dead|killed|shelved|abandoned|discontinued|not happening|scrapped)\b/i, signal: "cancelled" },
  { regex: /\b(?:feedback|review|came back|responded|replied|answered)\b.*\b(?:positive|good|great|love|excellent|impressed|amazing|terrific)\b/i, signal: "positive_feedback" },
  { regex: /\b(?:feedback|review|came back|responded|replied|answered)\b.*\b(?:negative|bad|poor|disappointed|unhappy|hate|terrible|awful)\b/i, signal: "negative_feedback" },
  { regex: /\b(?:agreement|contract|signed|deal closed|committed|partnership closed|nda signed|closed the deal)\b/i, signal: "deal_closed" },
  { regex: /\b(?:meeting|call|sync|catch[ -]?up|discussion)\s+(?:booked|scheduled|set up|planned|arranged|confirmed)\b/i, signal: "meeting_scheduled" },
  { regex: /\b(?:discovery|learning|found out|realized|discovered|learned|understood|insight|breakthrough)\b/i, signal: "discovery" },
  { regex: /\b(?:decision|decided|chose|chosen|pick|picked|settled on|going with|opted)\b/i, signal: "decision_made" },
  { regex: /\b(?:concern|worried|risk|risky|danger|warning|careful|cautious|hesitant|apprehensive)\b/i, signal: "concern_raised" },
  { regex: /\b(?:milestone|goal reached|target hit|achieved|milestone hit|target met|delivered on)\b/i, signal: "milestone_reached" },
  { regex: /\b(?:progress|progressing|moving forward|advancing|making headway|momentum|traction|picking up)\b/i, signal: "progress" },
  { regex: /\b(?:delayed|postponed|pushed back|rescheduled|extended|deadline moved|behind schedule|late)\b/i, signal: "delayed" },
  { regex: /\b(?:technical|tech|engineering|implementation|architecture|code)\s+(?:challenge|issue|problem|difficulty|complexity|debt|bug)\b/i, signal: "technical_challenge" },
];

export function detectSignal(text: string): string | null {
  for (const { regex, signal } of SIGNAL_PATTERNS) {
    if (regex.test(text)) return signal;
  }
  return null;
}

export function detectEventType(text: string): CaptureEventType {
  const lower = text.toLowerCase().substring(0, 500);

  const beliefPatterns = [
    /\b(?:I (?:believe|think|feel|suspect|guess|assume|consider|reckon|imagine)\b)/i,
    /\b(?:in my (?:opinion|view|experience|assessment))\b/i,
  ];
  if (beliefPatterns.some((r) => r.test(lower))) return "belief";

  const goalPatterns = [
    /\b(?:goal|aim|objective|target)\s+(?:is|:)\b/i,
    /\b(?:want to|plan to|aim to|trying to|working towards|striving)\b/i,
    /\b(?:by\s+(?:q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}))\b/i,
  ];
  if (goalPatterns.some((r) => r.test(lower))) return "goal";

  const eventPatterns = [
    /\b(?:meeting|met|had a call|had a chat|conference|event|workshop|presentation|demo|showed)\b/i,
    /\b(?:yesterday|today|this morning|this afternoon|last night|earlier)\b/i,
  ];
  if (eventPatterns.some((r) => r.test(lower))) return "event";

  const decisionPatterns = [
    /\b(?:decided|decision|chose|chosen|pick|picked|going with|settled on|i'll|i will|we'll|we will|will go with)\b/i,
    /\b(?:let's\b)\b/i,
  ];
  if (decisionPatterns.some((r) => r.test(lower))) return "decision";

  return "observation";
}

export function extractParticipants(text: string): string[] {
  const knownNames = [
    "george", "radarboy", "radarboy3000", "gino", "andy", "andy yang",
    "john", "mike", "sarah", "david", "alex", "chris", "emma", "james",
    "mark", "paul", "tom", "lisa", "kate", "sam", "michael",
  ];
  const lower = text.toLowerCase();
  return knownNames.filter((n) => {
    const regex = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(lower);
  });
}

export function extractTopics(text: string): string[] {
  const topicKeywords: Record<string, string> = {
    flyd: "flyd|memory system|knowledge base|personal wiki",
    koko: "koko|koko app|koko project",
    "smart glasses": "smart glasses|ar glasses|augmented reality",
    "graffiti machine": "graffiti machine|graf machine|graffiti",
    tastemaker: "tastemaker|taste maker",
    postraction: "postraction|post traction",
    bridgestone: "bridgestone|bridgestone campaign",
    sponsorship: "sponsor|sponsorship|funding|revenue",
    ai: "ai|artificial intelligence|llm|language model",
    coding: "coding|programming|development|software",
    art: "art|gallery|exhibition|artwork|design|creative",
    reaktiv: "reaktiv|reactiv",
    rbvj: "rbvj",
    cowsite: "cowsite",
    "good neighbours": "good neighbour|gnc|good neighbor",
  };

  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const [topic, pattern] of Object.entries(topicKeywords)) {
    if (new RegExp(`\\b(${pattern})\\b`, "i").test(lower)) {
      found.push(topic);
    }
  }
  return found;
}

export function isValidEventOutcome(val: string): val is EventOutcome {
  return VALID_OUTCOMES.has(val);
}

export function isValidEventType(val: string): val is CaptureEventType {
  return VALID_EVENT_TYPES.has(val);
}

export function extractEventFromFrontmatter(metadata: Record<string, unknown>): EventMetadata {
  const res: EventMetadata = {};

  const rawType = metadata.event_type ?? metadata.type;
  if (typeof rawType === "string" && isValidEventType(rawType)) {
    res.event_type = rawType;
  }

  if (typeof metadata.signal === "string" && metadata.signal.length > 0) {
    res.signal = metadata.signal;
  }

  const conf = Number(metadata.confidence);
  if (!isNaN(conf) && conf >= 0 && conf <= 1) {
    res.confidence = conf;
  }

  if (Array.isArray(metadata.participants)) {
    res.participants = metadata.participants.map(String).filter(Boolean);
  }

  const rawOutcome = metadata.outcome;
  if (typeof rawOutcome === "string" && isValidEventOutcome(rawOutcome)) {
    res.outcome = rawOutcome;
  }

  if (Array.isArray(metadata.topics)) {
    res.topics = metadata.topics.map(String).filter(Boolean);
  }

  return res;
}
