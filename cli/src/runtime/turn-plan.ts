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

export interface TurnPlan {
  route: TurnRoute;
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
export function planTurn(route: TurnRoute | null, cover: string[] = [], options: { unattended?: boolean } = {}): TurnPlan | null {
  if (options.unattended || route === null) return null;
  switch (route) {
    case "answer":
      return {
        route, cover, allows: new Set(["read"]), handoffs: new Set(), budget: null,
        hidden: new Set(CHANGE_ONLY),
        instruction: "This turn is an answer. Look up what you need, then answer him. Don't start work or change anything; if doing something would clearly help, offer it in one line.",
      };
    case "clarify":
      return {
        route, cover, allows: new Set(["read"]), handoffs: new Set(), budget: { iterations: 3, toolCalls: 2 },
        hidden: new Set(CHANGE_ONLY),
        instruction: "What he wants isn't clear enough to act on. Ask one short question about what he means. Offer options only if the conversation points to them; never invent any. Don't research first.",
      };
    case "delegate":
      // Reading the code is the crewmate's job, not the dispatcher's: given
      // repo tools, the model explores until its budget runs out and never
      // hands off. So the only tools here are the hand-offs, and one call.
      return {
        route, cover, allows: new Set(), handoffs: new Set(HANDOFFS), budget: { iterations: 3, toolCalls: 2 },
        hidden: null,
        instruction: "This is work to hand off now, not to do or research inline: whoever takes it reads the code and does the work. Turn what he asked into a clear outcome and done_when points that can be checked, in his terms, and hand it off in your first step: a change to code in one of his repos goes to start_coding_task (repo = that project's path), anything else to background_task. Then tell him in a line what you started.",
      };
    case "act":
      return {
        // A few quick steps; past this it should have been handed off.
        route, cover, allows: new Set(["read", "local", "outward", "destructive"]), handoffs: new Set(HANDOFFS), budget: { iterations: 10, toolCalls: 12 },
        hidden: new Set(),
        instruction: "He wants this done. Do it with the tools, check it worked, then tell him in a line or two. Anything bigger than a few quick steps goes to background_task or start_coding_task instead.",
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
