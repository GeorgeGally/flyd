import { evaluatePredicates, JEV_PINNED_MODEL } from "../cognition/system-one/jev.js";
import { familyEgress, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import { classifyToolCall, type ActionCategory } from "./tool-policy.js";

// What kind of turn this is, decided once before the loop and enforced by
// the harness, not argued out by the model mid-loop.
//
// Every recurring chat failure had the same shape: the model was handed all
// ~23 tools and a long list of rules that pull against each other ("make the
// edit yourself" / "hand substantial work to the crew"; "act now" / "ask when
// it's ambiguous"; "never just comment" / "stop when you've answered"), and it
// resolved the conflict differently each time. So it explored a feature it
// should have handed off, spawned a background job to answer a sum, burned
// fifteen tool calls on a question it should have asked back, and answered
// "anything I should know?" with a single line.
//
// Reading the room already works out what George needs. The plan turns that
// reading into a contract for the turn: a route that decides which tools are
// on the table and what they may do, a budget sized to the route, and the
// points the reply must cover. Rules the harness enforces no longer have to
// live in the prompt, where they only compete.

export type TurnRoute = "answer" | "clarify" | "act" | "delegate";

export const TURN_ROUTES: TurnRoute[] = ["answer", "clarify", "act", "delegate"];

export interface TurnBudget { iterations: number; toolCalls: number }

/** How the route was decided: Jev when it's sure (~0.3s), else the LLM room reading (~10s). */
export interface RouteReading { route: TurnRoute; confidence: number; source: "jev" | "llm" }

export interface TurnPlan {
  route: TurnRoute;
  source: RouteReading["source"];
  /** What the reply must address: the turn's done_when. */
  cover: string[];
  /** Tools kept out of sight on this route; null keeps only the hand-offs in sight. */
  hidden: Set<string> | null;
  /** Action categories a call may have on this route. */
  allows: Set<ActionCategory>;
  /** Tools allowed on this route even though they start work (the hand-offs). */
  handoffs: Set<string>;
  budget: TurnBudget | null;
  instruction: string;
}

// Looking things up is always fine. Tools that can only change things are
// hidden on routes that shouldn't change anything, so the model isn't
// tempted; tools with a read action (todos list, schedule list, reminders
// list) stay visible and the gate stops their writes.
const CHANGE_ONLY = ["edit_file", "write_file", "remember", "work_model", "speaking_style", "background_task", "start_coding_task"];
const HANDOFFS = ["background_task", "start_coding_task"];

/**
 * The plan for a turn. `unattended` runs (background jobs, the agenda) are the
 * work itself, so they always act.
 */
export function planTurn(reading: Pick<RouteReading, "route" | "source"> | null, cover: string[] = [], options: { unattended?: boolean } = {}): TurnPlan | null {
  if (options.unattended || reading === null) return null;
  const { route, source } = reading;
  switch (route) {
    case "answer":
      return {
        route, source, cover, allows: new Set(["read"]), handoffs: new Set(), budget: null,
        hidden: new Set(CHANGE_ONLY),
        instruction: "This turn is an answer. Look up what you need, then answer him. Don't start work or change anything; if doing something would clearly help, offer it in one line.",
      };
    case "clarify":
      return {
        route, source, cover, allows: new Set(["read"]), handoffs: new Set(), budget: { iterations: 3, toolCalls: 2 },
        hidden: new Set(CHANGE_ONLY),
        instruction: "What he wants isn't clear enough to act on. Ask one short question about what he means. Offer options only if the conversation points to them; never invent any. Don't research first.",
      };
    case "delegate":
      // Reading the code is the crewmate's job, not the dispatcher's: given
      // repo tools, the model explores until its budget runs out and never
      // hands off. So the only tools here are the hand-offs, and one call.
      return {
        route, source, cover, allows: new Set(), handoffs: new Set(HANDOFFS), budget: { iterations: 3, toolCalls: 2 },
        hidden: null,
        instruction: "This is work to hand off now, not to do or research inline: whoever takes it reads the code and does the work. Turn what he asked into a clear outcome and done_when points that can be checked, in his terms, and hand it off in your first step: a change to code in one of his repos goes to start_coding_task (repo = that project's path), anything else to background_task. Then tell him in a line what you started.",
      };
    case "act":
      return {
        // A few quick steps; past this it should have been handed off.
        route, source, cover, allows: new Set(["read", "local", "outward", "destructive"]), handoffs: new Set(HANDOFFS), budget: { iterations: 10, toolCalls: 12 },
        hidden: new Set(),
        instruction: "He wants this done. Do it with the tools, check it worked, then tell him in a line or two. A change to code in a repo, or anything bigger than a few quick steps, goes to start_coding_task or background_task instead.",
      };
  }
}

/** The tools the model sees on this turn. */
export function visibleTools<T extends { name: string }>(tools: T[], plan: TurnPlan | null): T[] {
  if (!plan) return tools;
  if (plan.hidden === null) return tools.filter((tool) => plan.handoffs.has(tool.name));
  return plan.hidden.size ? tools.filter((tool) => !plan.hidden!.has(tool.name)) : tools;
}

/**
 * The gate for one call: null to run it, or the reason it's off this turn.
 * Hiding a tool is a nudge; this is the rule (a bash that writes is still bash).
 */
export function offRoute(plan: TurnPlan | null, name: string, input: Record<string, unknown>): string | null {
  if (!plan) return null;
  if (plan.handoffs.has(name)) return null;
  const category = classifyToolCall(name, input);
  if (plan.allows.has(category)) return null;
  const why = plan.route === "delegate"
    ? "this turn hands the work off; whoever takes it does the reading. Call start_coding_task or background_task now with an outcome and done_when points."
    : "this turn is for answering him, not changing anything. Offer it in one line; he'll say if he wants it.";
  return `Skipped (not this turn): ${why}`;
}

export function planBrief(plan: TurnPlan): string {
  return [
    `This turn: ${plan.instruction}`,
    plan.cover.length ? `Your reply must cover, however short it is:\n${plan.cover.map((point) => `- ${point}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

/** A plan's budget never loosens the default one; it only tightens it. */
export function planBudget<B extends TurnBudget>(defaults: B, plan: TurnPlan | null): B {
  if (!plan?.budget) return defaults;
  return { ...defaults, iterations: Math.min(defaults.iterations, plan.budget.iterations), toolCalls: Math.min(defaults.toolCalls, plan.budget.toolCalls) };
}

/**
 * The route from Jev (`chat_turn_route`, benched in the System-1 replay suite):
 * a confident answer decides the turn; below the threshold it only stands in
 * if the LLM reading fails too. The threshold was benched on the pinned
 * release, so this asks that release, not jev-latest. Off with
 * FLYD_JEV_TURN_ROUTE=0 or no key.
 */
export async function routeWithJev(message: string, history: Array<{ role: string; content: string }> = []): Promise<RouteReading & { decided: boolean; needsCode: boolean | null } | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || process.env.FLYD_JEV_TURN_ROUTE === "0") return null;
  // Flyd's offer ("want me to…?") ends its reply, so keep the tail of what it said.
  const recap = history.slice(-4).map((turn) => {
    const text = turn.content.replace(/\s+/g, " ");
    return turn.role === "user" ? `George: ${text.slice(0, 240)}` : `Flyd: …${text.slice(-320)}`;
  }).join("\n");
  const question = questionFor("chat_turn_route");
  const code = questionFor("chat_turn_needs_code");
  const result = await evaluatePredicates({ utterance: message, conversation_recap: recap }, [question, code], { apiKey, timeoutMs: 3_000, model: process.env.FLYD_JEV_MODEL ?? JEV_PINNED_MODEL }, familyEgress("chat"));
  const answer = result.answers[question.id];
  const route = answer?.choice as TurnRoute | undefined;
  if (!result.ok || !route || !TURN_ROUTES.includes(route)) return null;
  // Does the turn need his code opened? Yes/no only when Jev is sure; unsure is null.
  const codeThreshold = predicateThreshold("chat_turn_needs_code");
  const p = result.answers[code.id]?.probability;
  const needsCode = p === undefined ? null : p >= codeThreshold ? true : p <= 1 - codeThreshold ? false : null;
  return { route, confidence: answer.confidence, source: "jev", decided: answer.confidence >= predicateThreshold("chat_turn_route"), needsCode };
}

/** Tools that read or change a codebase; out of reach on a turn that isn't about code. */
export const CODE_TOOLS = new Set(["read_file", "grep", "list_files", "git_log", "edit_file", "write_file"]);

/**
 * On a turn about a project rather than its code ("stuck on the CleanX
 * launch"), the answer comes from what Flyd knows about the project. A
 * prompt rule saying so was ignored run after run, so the harness holds it:
 * code tools are out of sight, and a shell command that goes into one of his
 * repos or runs git is stopped.
 */
export function offCode(codeTurn: boolean, name: string, input: Record<string, unknown>, repoRoots: string[]): string | null {
  if (codeTurn) return null;
  const why = "Skipped (not this turn): he's talking about the project, not its code. Answer from what you know about it (His projects); if the code would really help, offer to look.";
  if (CODE_TOOLS.has(name)) return why;
  if (name !== "bash") return null;
  if (String(input.repo ?? "").trim()) return why;
  const command = String(input.command ?? "");
  if (/(?:^|[\s;&|(])git\s/.test(command)) return why;
  return repoRoots.some((root) => root && command.includes(root)) ? why : null;
}
