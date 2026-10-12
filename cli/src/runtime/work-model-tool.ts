import type { AgentTool } from "../lib/llm.js";
import type { WorkHypothesis, WorkThread } from "../work/work-hypothesis/types.js";

// The one tool for "what is George working on". Chat kept answering work
// questions with email_search, recall and bash because the tool only took
// corrections and was hidden on answer turns; it now reads as well as
// corrects, says which questions it serves, checks its arguments before it
// runs, and returns ranked items the model can answer from directly.

export const WORK_MODEL_DEFAULT_LIMIT = 5;
export const WORK_MODEL_MAX_LIMIT = 10;
const MAX_TOPICS = 10;
const ARGUMENTS = new Set(["action", "statement", "limit", "topics"]);

export const workModelTool: AgentTool = {
  name: "work_model",
  description: "Flyd's model of what George is working on: the tool for work status. action=show ranks his priorities, each with a short reason. Use it for \"what should I work on?\", \"my top priorities\", \"what's next?\", \"what am I working on?\", \"work model\". action=correct records his correction, e.g. \"I'm not working on Bridgestone anymore\", \"CleanX is done\", \"I'm also working on Koko\"; pass his statement verbatim. Both return the ranked list: answer from it, without also searching mail, memory or files for the same thing.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["show", "correct"], description: "show = ranked priorities (default without a statement); correct = record his correction (default with a statement)" },
      statement: { type: "string", description: "For correct: George's correction, in his words" },
      limit: { type: "integer", description: `How many ranked items to return, 1-${WORK_MODEL_MAX_LIMIT} (default ${WORK_MODEL_DEFAULT_LIMIT})` },
      topics: { type: "array", items: { type: "string" }, description: "Only items about these projects or words" },
    },
    required: [],
  },
};

export interface WorkModelArgs {
  action: "show" | "correct";
  statement: string;
  limit: number;
  topics: string[];
}

export interface WorkModelItem {
  rank: number;
  name: string;
  reason: string;
}

/** The call's arguments, or a clear error the model can correct in the same turn. */
export function parseWorkModelArgs(input: Record<string, unknown>): { args: WorkModelArgs } | { error: string } {
  const unknown = Object.keys(input).find((key) => !ARGUMENTS.has(key));
  if (unknown) return { error: `Error: work_model takes action, statement, limit and topics; "${unknown}" is not one of them` };
  if (input.statement !== undefined && typeof input.statement !== "string") return { error: "Error: work_model statement must be text: George's words" };
  const statement = (input.statement ?? "").toString().trim();
  if (input.action !== undefined && input.action !== "show" && input.action !== "correct") {
    return { error: `Error: work_model action must be "show" or "correct" (got ${JSON.stringify(input.action)})` };
  }
  const action = input.action ?? (statement ? "correct" : "show");
  if (action === "correct" && !statement) return { error: "Error: work_model action=correct needs George's statement" };
  const limit = input.limit ?? WORK_MODEL_DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > WORK_MODEL_MAX_LIMIT) {
    return { error: `Error: work_model limit must be a whole number from 1 to ${WORK_MODEL_MAX_LIMIT} (got ${JSON.stringify(input.limit)})` };
  }
  const topics = input.topics ?? [];
  if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== "string" || !topic.trim())) {
    return { error: "Error: work_model topics must be a list of project names or words, e.g. [\"CleanX\"]" };
  }
  if (topics.length > MAX_TOPICS) return { error: `Error: work_model takes at most ${MAX_TOPICS} topics (got ${topics.length})` };
  return { args: { action: action as WorkModelArgs["action"], statement, limit, topics: topics.map((topic) => topic.trim()) } };
}

/** Whether a call reads the model or changes it; unreadable calls count as changes. */
export function workModelAction(input: Record<string, unknown>): WorkModelArgs["action"] {
  const parsed = parseWorkModelArgs(input);
  return "args" in parsed ? parsed.args.action : "correct";
}

function ago(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function reasonFor(thread: WorkThread, primary: boolean, now: Date): string {
  const parts = [primary ? "a main thread" : "on the side"];
  if (thread.isForeground) parts.push("open in front of him");
  if (thread.lastCommitAt) {
    const when = ago(thread.lastCommitAt, now);
    if (when) parts.push(thread.latestSubject ? `last commit ${when}: ${thread.latestSubject}` : `last commit ${when}`);
  }
  if (thread.hasTasks) parts.push("open tasks");
  if (thread.isDirty) parts.push("uncommitted changes");
  return parts.join("; ");
}

/** The model's threads, best first: main threads, then side ones; demoted ones never. */
export function rankWorkModel(
  hypothesis: WorkHypothesis | null,
  options: { limit?: number; topics?: string[]; now?: Date } = {},
): WorkModelItem[] {
  if (!hypothesis) return [];
  const now = options.now ?? new Date();
  const topics = (options.topics ?? []).map((topic) => topic.toLowerCase());
  const seen = new Set<string>();
  const ranked = [
    ...hypothesis.primaryThreads.map((thread) => ({ thread, primary: true })),
    ...hypothesis.secondaryThreads.map((thread) => ({ thread, primary: false })),
  ].filter(({ thread }) => {
    const key = thread.name.toLowerCase();
    if (thread.demoted || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ thread, primary }) => ({ name: thread.name, reason: reasonFor(thread, primary, now) }))
    .filter((item) => !topics.length || topics.some((topic) => `${item.name} ${item.reason}`.toLowerCase().includes(topic)));
  return ranked.slice(0, options.limit ?? WORK_MODEL_DEFAULT_LIMIT).map((item, index) => ({ rank: index + 1, ...item }));
}

/** What the tool returns: the ranked items plus what stands next to them. */
export function formatWorkModelResult(
  hypothesis: WorkHypothesis | null,
  args: Pick<WorkModelArgs, "limit" | "topics">,
  extra: Record<string, unknown> = {},
  now = new Date(),
): string {
  const items = rankWorkModel(hypothesis, { limit: args.limit, topics: args.topics, now });
  return JSON.stringify({
    ...extra,
    items,
    ...(hypothesis?.insights?.nextTodo ? { nextTodo: hypothesis.insights.nextTodo } : {}),
    ...(hypothesis ? { confidence: hypothesis.confidence, asOf: hypothesis.revisedAt } : { note: "Flyd has no picture of his work yet" }),
  });
}
