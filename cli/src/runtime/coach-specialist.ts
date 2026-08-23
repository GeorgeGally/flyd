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
import { discoverSkills, skillsDirectory } from "../lib/agent-dir.js";
import type { FounderEventType } from "../work-intelligence/types.js";

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

export interface CoachSkillInput {
  message: string;
  grounding: string;
  dependencies: CoachResponderDependencies;
}

export interface CoachSkill {
  name: string;
  triggers: string[];
  contract: EvalContract;
  /** Diagnose-style skills refuse to run below the grounding threshold. */
  groundingRequired: boolean;
  journalEvent?: string;
  run(input: CoachSkillInput): Promise<string | null>;
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

// Skill bodies: prompt templates and metadata are authored in
// cli/agent/skills/*.md; these built-in specs are the fallback when the
// agent directory is absent, plus the code implementations for skills whose
// behavior is not expressible as a template.
interface SkillSpec {
  name: string;
  triggers: string[];
  contract: EvalContract;
  impl?: string;
  journalEvent?: FounderEventType;
  groundingRequired?: boolean;
  template?: string;
}

const BUILTIN_SKILLS: SkillSpec[] = [
  {
    name: "check_in",
    triggers: ["check in", "checkin", "how am i doing", "daily"],
    journalEvent: "coach_checkin",
    contract: {
      goal: "Capture mood, focus, priorities, blockers; fold into patterns and journal",
      dimensions: [
        "CAPTURE — records mood/focus/priorities/blockers the user gives",
        "COMPOUND — key observations become a pattern or goal update",
        "RESOLVE_BEFORE_ASK — exhausts known state before asking",
      ],
      hardFails: ["Must not invent user answers not provided"],
    },
    template:
      "User check-in: {{message}}\n\nKnown about George:\n{{grounding}}\n\nAsk the smallest number of questions to capture mood, focus, priorities, and blockers. Note what you already know rather than re-asking.\n\nCoach:",
  },
  {
    name: "retrospective",
    triggers: ["retro", "how did that go", "review that", "what worked"],
    journalEvent: "coach_retrospective",
    contract: {
      goal: "Reflect on a completed interaction/task and journal what was offered vs what the user did",
      dimensions: [
        "HONESTY — states what was offered and what actually happened",
        "LEARNING — extracts a reusable pattern or goal adjustment",
      ],
      hardFails: ["Must not fabricate outcomes"],
    },
    template:
      "Retrospective on: {{message}}\n\nKnown about George:\n{{grounding}}\n\nReflect on what was offered, what the user did, and what that teaches. Propose ONE pattern or goal adjustment if warranted.\n\nCoach:",
  },
  {
    name: "goal_adjust",
    triggers: ["update my goal", "adjust goal", "change my goal", "new goal"],
    impl: "goal_adjust",
    contract: {
      goal: "Record or adjust a goal with a stated source",
      dimensions: [
        "RECORD — a goal is persisted",
        "TRACE — source is captured",
      ],
      hardFails: ["Must not fabricate the goal statement"],
    },
  },
  {
    name: "goal_drop",
    triggers: [
      "off my plate", "off the plate", "not working on", "stop working on",
      "done with", "drop the", "drop it", "take that weight off",
      "someone else is handling", "friend is doing", "not doing anymore",
    ],
    impl: "goal_drop",
    contract: {
      goal: "Honor a deprioritization: archive goals the user has explicitly taken off their plate",
      dimensions: [
        "HONOR — the goal is archived so it stops re-surfacing",
        "SPECIFIC — only the goals the user named are dropped, not unrelated ones",
      ],
      hardFails: ["Must not archive a goal the user did not name"],
    },
  },
  {
    name: "diagnose",
    triggers: [],
    groundingRequired: true,
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
    template:
      "User message: {{message}}\n\nKnown about George:\n{{grounding}}\n\nCoach:",
  },
];

async function goalAdjustRun({ message }: CoachSkillInput): Promise<string | null> {
  const statement = message.replace(/.*?(update my goal|adjust goal|change my goal|new goal)[:,]?\s*/i, "").trim() || message;
  const goal = addGoal(statement, "check-in");
  return `Noted as a goal: "${goal.statement}". I'll hold you to it.`;
}

async function goalDropRun({ message }: CoachSkillInput): Promise<string | null> {
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
}

function materializeSkill(spec: SkillSpec): CoachSkill {
  const run = spec.impl === "goal_adjust"
    ? goalAdjustRun
    : spec.impl === "goal_drop"
      ? goalDropRun
      : async ({ message, grounding, dependencies }: CoachSkillInput): Promise<string | null> => {
          // Single pass — sequential replaceAll would let a message containing
          // "{{grounding}}" get rewritten by the second substitution.
          const prompt = (spec.template ?? "").replace(
            /\{\{message\}\}|\{\{grounding\}\}/g,
            (token) => (token === "{{message}}" ? message : grounding),
          );
          const reply = await modelCall(dependencies, prompt, standardSystem());
          if (spec.journalEvent) {
            try {
              const ids = journalId(dependencies);
              recordJournalEntry({
                entryId: `${spec.journalEvent}-${Date.now()}`,
                interactionId: ids.interactionId,
                workSessionId: ids.workSessionId,
                timestamp: new Date().toISOString(),
                eventType: spec.journalEvent,
                details: { focus: message.slice(0, 100) },
              });
            } catch {
              // journaling must never break a skill run
            }
          }
          return reply.trim();
        };
  return {
    name: spec.name,
    triggers: spec.triggers,
    contract: spec.contract,
    groundingRequired: spec.groundingRequired ?? false,
    journalEvent: spec.journalEvent,
    run,
  };
}

let skillsCache: { dir: string | null; skills: CoachSkill[] } | null = null;

/** Journal event names authored files may reference. */
const KNOWN_JOURNAL_EVENTS: ReadonlySet<string> = new Set([
  "coach_checkin", "coach_retrospective",
]);

/** Built-ins merged with authored overrides from cli/agent/skills/. */
export function coachSkills(): CoachSkill[] {
  const dir = skillsDirectory();
  if (skillsCache && skillsCache.dir === dir) return skillsCache.skills;
  const specs = new Map(BUILTIN_SKILLS.map((s) => [s.name, s]));
  for (const authored of discoverSkills()) {
    // An override that omits grounding_required inherits the built-in's gate.
    const inheritedGrounding = specs.get(authored.name)?.groundingRequired;
    const journalEvent =
      authored.journalEvent && KNOWN_JOURNAL_EVENTS.has(authored.journalEvent)
        ? (authored.journalEvent as FounderEventType)
        : undefined;
    specs.set(authored.name, {
      name: authored.name,
      triggers: authored.triggers,
      contract: {
        goal: authored.contractGoal,
        dimensions: authored.dimensions,
        hardFails: authored.hardFails,
      },
      impl: authored.impl,
      journalEvent,
      groundingRequired: authored.groundingRequired ?? inheritedGrounding ?? false,
      template: authored.template,
    });
  }
  skillsCache = { dir, skills: [...specs.values()].map(materializeSkill) };
  return skillsCache.skills;
}

/** Test-only: reload authored skills on next access. */
export function resetCoachSkillsCache(): void {
  skillsCache = null;
}

export function routeCoachSkill(message: string): CoachSkill | undefined {
  const lower = message.toLowerCase();
  const skills = coachSkills();
  return skills.find((s) => s.triggers.some((t) => lower.includes(t)));
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
    skills: coachSkills(),
    async dispatch(context: SpecialistContext): Promise<string | null> {
      // R5 boundary: only read data scopes the user has granted. Default grant
      // is existing_signals (what Flyd already holds), always on — no new
      // capture, no network. Non-default scopes (browsing/extended) are off.
      if (!hasCoachGrant("existing_signals")) {
        return "The coach's access to your existing Flyd signals is currently disabled. Re-enable it to get grounded coaching.";
      }
      const grounding = buildGrounding(context);
      const all = coachSkills();
      const skill = routeCoachSkill(context.message)
        ?? all.find((s) => s.groundingRequired)
        ?? all[all.length - 1];

      // Grounding-required skills refuse to coach without real data —
      // otherwise they would give generic advice.
      if (skill.groundingRequired && groundingCount(context) < MIN_GROUNDING) {
        return "I need more grounding before I can coach you usefully. Tell me a current goal, or do a quick check-in (mood, focus, priorities, blockers), and I'll work from real data instead of generic advice.";
      }

      const reply = await skill.run({ message: context.message, grounding, dependencies: respond });

      // A skill may decline (e.g. goal_drop found nothing to drop) — fall
      // through to the diagnose-style skill rather than returning null.
      if (reply === null) {
        if (groundingCount(context) < MIN_GROUNDING) {
          return "I need more grounding before I can coach you usefully. Tell me a current goal, or do a quick check-in (mood, focus, priorities, blockers), and I'll work from real data instead of generic advice.";
        }
        const fallback = all.find((s) => s.groundingRequired) ?? all[all.length - 1];
        return fallback.run({ message: context.message, grounding, dependencies: respond });
      }

      return reply;
    },
  };
}
