import { query } from "../lib/llm.js";
import { resolveModelConnection } from "../lib/config.js";
import { DOMAIN_STANDARDS } from "../work-intelligence/domain-standards.js";
import {
  listGoals, listPatterns, addGoal,
  adjustGoal, archiveGoal, type CoachPattern,
} from "./coach-memory.js";
import {
  recordJournalEntry, listJournalEntries,
} from "../work-intelligence/outcome-journal.js";
import { hasCoachGrant } from "./coach-grants.js";
import type { SpecialistContext } from "./specialist-registry.js";

export interface CoachResponderDependencies {
  model?: {
    model: string;
    apiKey: string;
    baseURL?: string;
  };
  queryText?: typeof query;
  interactionId?: () => string;
  workSessionId?: () => string;
}

export interface EvalContract {
  goal: string;
  dimensions: string[];
  hardFails: string[];
}

export interface CoachSkill {
  name: string;
  triggers: string[];
  contract: EvalContract;
  run(input: { message: string; grounding: string; dependencies: CoachResponderDependencies }): Promise<string | null>;
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

function journalId(deps: CoachResponderDependencies): { interactionId: string; workSessionId: string } {
  return {
    interactionId: deps.interactionId ? deps.interactionId() : "coach",
    workSessionId: deps.workSessionId ? deps.workSessionId() : "coach",
  };
}

function standardSystem(standard = DOMAIN_STANDARDS.coach): string {
  return [
    "You are George's coach — a distillation of the world's best wellness, business, and life coaches.",
    "You never give generic advice. Every intervention is grounded in the user's actual goals, journal, check-ins, and known patterns.",
    "Reply in plain text only. No markdown, no HTML tags, no bold, no headers — just clear conversational words.",
    "You are a coach, not a task executor. When the user is working through how they feel or a decision, explore the human side — the feeling, the pattern, the underlying want — before any action. Do not jump to drafting messages, writing replies, or issuing action lists unless the user explicitly asks you to do the task.",
    "Honor corrections. If the user says a goal is off their plate or that they are no longer doing something, stop re-surfacing it immediately. Do not drag the conversation back to a topic the user has already set aside.",
    `Evaluation dimensions: ${standard.evaluationDimensions.join("; ")}`,
    `Avoidances: ${standard.avoidances.join("; ")}`,
    "Be direct and specific. Diagnose the ONE causal issue. Propose ONE high-leverage intervention.",
  ].join(" ");
}

async function modelCall(deps: CoachResponderDependencies, prompt: string, system: string): Promise<string> {
  const connection = deps.model ?? resolveModelConnection();
  const raw = await (deps.queryText ?? query)(
    prompt,
    connection.model,
    system,
    connection.apiKey,
    connection.baseURL,
  );
  return stripMarkdown(raw);
}

// The coach answers in a chat pane, not a rendered markdown surface. Strip
// markdown/HTML so the reply is clean plain text (e.g. "<strong>Coach:</strong>"
// or "**bold**" from the model must not leak into the CLI).
function stripMarkdown(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^```[\s\S]*?```$/gm, "")
    .replace(/^[-*]\s+/gm, "- ")
    .trim();
}

const diagnoseSkill: CoachSkill = {
  name: "diagnose",
  triggers: [],
  contract: {
    goal: "One high-leverage, non-generic intervention grounded in the user's actual state",
    dimensions: [
      "GROUNDING — names a specific goal/pattern/obligation from real user data",
      "SINGLE_FOCUS — one intervention, not a list",
      "LEVERAGE — highest-leverage causal issue, not a topic",
    ],
    hardFails: [
      "Any intervention not grounded in actual user data = auto-zero (R6)",
    ],
  },
  async run({ message, grounding, dependencies }) {
    const reply = await modelCall(
      dependencies,
      `User message: ${message}\n\nKnown about George:\n${grounding}\n\nCoach:`,
      standardSystem(),
    );
    return reply.trim();
  },
};

const checkInSkill: CoachSkill = {
  name: "check_in",
  triggers: ["check in", "checkin", "how am i doing", "daily"],
  contract: {
    goal: "Capture mood, focus, priorities, blockers; fold into patterns and journal",
    dimensions: [
      "CAPTURE — records mood/focus/priorities/blockers the user gives",
      "COMPOUND — key observations become a pattern or goal update",
      "RESOLVE_BEFORE_ASK — exhausts known state before asking",
    ],
    hardFails: ["Must not invent user answers not provided"],
  },
  async run({ message, grounding, dependencies }) {
    const reply = await modelCall(
      dependencies,
      `User check-in: ${message}\n\nKnown about George:\n${grounding}\n\nAsk the smallest number of questions to capture mood, focus, priorities, and blockers. Note what you already know rather than re-asking.\n\nCoach:`,
      standardSystem(),
    );
    try {
      const ids = journalId(dependencies);
      recordJournalEntry({
        entryId: `coach-checkin-${Date.now()}`,
        interactionId: ids.interactionId,
        workSessionId: ids.workSessionId,
        timestamp: new Date().toISOString(),
        eventType: "coach_checkin",
        details: { focus: message.slice(0, 100) },
      });
    } catch {
      // journaling must never break a check-in
    }
    return reply.trim();
  },
};

const retrospectiveSkill: CoachSkill = {
  name: "retrospective",
  triggers: ["retro", "how did that go", "review that", "what worked"],
  contract: {
    goal: "Reflect on a completed interaction/task and journal what was offered vs what the user did",
    dimensions: [
      "HONESTY — states what was offered and what actually happened",
      "LEARNING — extracts a reusable pattern or goal adjustment",
    ],
    hardFails: ["Must not fabricate outcomes"],
  },
  async run({ message, grounding, dependencies }) {
    const reply = await modelCall(
      dependencies,
      `Retrospective on: ${message}\n\nKnown about George:\n${grounding}\n\nReflect on what was offered, what the user did, and what that teaches. Propose ONE pattern or goal adjustment if warranted.\n\nCoach:`,
      standardSystem(),
    );
    try {
      const ids = journalId(dependencies);
      recordJournalEntry({
        entryId: `coach-retro-${Date.now()}`,
        interactionId: ids.interactionId,
        workSessionId: ids.workSessionId,
        timestamp: new Date().toISOString(),
        eventType: "coach_retrospective",
        details: { focus: message.slice(0, 100) },
      });
    } catch {
      // journaling must never break a retrospective
    }
    return reply.trim();
  },
};

const goalAdjustSkill: CoachSkill = {
  name: "goal_adjust",
  triggers: ["update my goal", "adjust goal", "change my goal", "new goal"],
  contract: {
    goal: "Record or adjust a goal with a stated source",
    dimensions: [
      "RECORD — a goal is persisted",
      "TRACE — source is captured",
    ],
    hardFails: ["Must not fabricate the goal statement"],
  },
  async run({ message, dependencies }) {
    const statement = message.replace(/.*?(update my goal|adjust goal|change my goal|new goal)[:,]?\s*/i, "").trim() || message;
    const goal = addGoal(statement, "check-in");
    return `Noted as a goal: "${goal.statement}". I'll hold you to it.`;
  },
};

const goalDropSkill: CoachSkill = {
  name: "goal_drop",
  triggers: [
    "off my plate", "off the plate", "not working on", "stop working on",
    "done with", "drop the", "drop it", "take that weight off",
    "someone else is handling", "friend is doing", "not doing anymore",
  ],
  contract: {
    goal: "Honor a deprioritization: archive goals the user has explicitly taken off their plate",
    dimensions: [
      "HONOR — the goal is archived so it stops re-surfacing",
      "SPECIFIC — only the goals the user named are dropped, not unrelated ones",
    ],
    hardFails: ["Must not archive a goal the user did not name"],
  },
  async run({ message, grounding, dependencies }) {
    const active = listGoals();
    const words = message.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const dropped: string[] = [];
    for (const goal of active) {
      const goalWords = goal.statement.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const overlap = goalWords.filter((w) => words.includes(w)).length;
      // only drop when the user's message names the goal's subject
      if (overlap >= 1) {
        archiveGoal(goal.id);
        dropped.push(goal.statement);
      }
    }
    if (dropped.length === 0) return null;
    return `Taken off your plate: ${dropped.join("; ")}. I'll stop re-surfacing it.`;
  },
};

const COACH_SKILLS: CoachSkill[] = [
  checkInSkill,
  retrospectiveSkill,
  goalAdjustSkill,
  goalDropSkill,
  diagnoseSkill,
];

export function routeCoachSkill(message: string): CoachSkill {
  const lower = message.toLowerCase();
  return (
    COACH_SKILLS.find((s) => s.triggers.some((t) => lower.includes(t))) ?? diagnoseSkill
  );
}

export function coachSkills(): CoachSkill[] {
  return COACH_SKILLS;
}

export function coachSpecialist(respond: CoachResponderDependencies = {}): {
  name: string;
  domain: string;
  skills: CoachSkill[];
  dispatch(input: SpecialistContext): Promise<string | null>;
} {
  return {
    name: "coach",
    domain: "coach",
    skills: COACH_SKILLS,
    async dispatch(context: SpecialistContext): Promise<string | null> {
      // R5 boundary: only read data scopes the user has granted. Default grant
      // is existing_signals (what Flyd already holds), always on — no new
      // capture, no network. Non-default scopes (browsing/extended) are off.
      if (!hasCoachGrant("existing_signals")) {
        return "The coach's access to your existing Flyd signals is currently disabled. Re-enable it to get grounded coaching.";
      }
      const grounding = buildGrounding(context);
      const skill = routeCoachSkill(context.message);

      // Diagnose needs real grounding before it coaches — otherwise it would
      // give generic advice. Other skills (check_in, goal_drop, goal_adjust)
      // are safe without it.
      if (skill === diagnoseSkill && groundingCount(context) < MIN_GROUNDING) {
        return "I need more grounding before I can coach you usefully. Tell me a current goal, or do a quick check-in (mood, focus, priorities, blockers), and I'll work from real data instead of generic advice.";
      }

      const reply = await skill.run({ message: context.message, grounding, dependencies: respond });

      // A skill may decline (e.g. goal_drop found nothing to drop) — fall
      // through to the diagnose skill rather than returning null.
      if (reply === null) {
        if (groundingCount(context) < MIN_GROUNDING) {
          return "I need more grounding before I can coach you usefully. Tell me a current goal, or do a quick check-in (mood, focus, priorities, blockers), and I'll work from real data instead of generic advice.";
        }
        return diagnoseSkill.run({ message: context.message, grounding, dependencies: respond });
      }

      return reply;
    },
  };
}
