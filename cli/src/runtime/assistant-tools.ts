import type { AgentTool } from "../lib/llm.js";

// Capabilities that used to be regex intercepts in front of the model. Each
// intercept guessed intent from phrasing and answered with canned text before
// the model ever saw the turn; as tools, the model decides when they apply.

export const assistantTools: AgentTool[] = [
  {
    name: "todos",
    description: "George's confirmed to-do list (the one Flyd's briefings and Present Model use). action=list shows open items; add appends items; done completes the item best matching query; replace sets the whole list.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "done", "replace"], description: "What to do" },
        items: { type: "string", description: "One item per line (add, replace); a due date like 'by Friday' is understood" },
        query: { type: "string", description: "Words identifying the item to complete (done)" },
      },
      required: ["action"],
    },
  },
  {
    name: "work_model",
    description: "Correct Flyd's model of what George is working on when he says so — e.g. \"I'm not working on Bridgestone anymore\", \"CleanX is done\", \"I'm also working on Koko\". Pass his statement verbatim.",
    input_schema: {
      type: "object",
      properties: {
        statement: { type: "string", description: "George's correction, in his words" },
      },
      required: ["statement"],
    },
  },
  {
    name: "speaking_style",
    description: "Set how Flyd writes its replies. asd-ste100 = literal, plain Simplified Technical English (short sentences, one idea each, no idioms); default = normal style. Use when George asks Flyd to change how it talks.",
    input_schema: {
      type: "object",
      properties: {
        style: { type: "string", enum: ["asd-ste100", "default"], description: "Style to use from now on" },
      },
      required: ["style"],
    },
  },
  {
    name: "flyd",
    description: "Flyd's own skills and jobs. action=skills lists durable skills, standards and pending Skillify proposals; skillify proposes turning recent work into a reusable skill; jobs_status shows background jobs; run_briefing runs the morning briefing job now; job_hunt shows job-search status; improve starts a self-improvement run now — pass George's words as feedback when he says Flyd should get better at something.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["skills", "skillify", "jobs_status", "run_briefing", "job_hunt", "improve"], description: "What to do" },
        feedback: { type: "string", description: "For improve: what George said Flyd should do better, in his words" },
        project: { type: "string", description: "Project for run_briefing (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "consult_specialist",
    description: "Hand a question to a Flyd specialist and get its answer to relay. coach = grounded coaching on goals, patterns, check-ins and retrospectives. Use when George asks for coaching or a check-in.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Specialist name, e.g. coach" },
        question: { type: "string", description: "What George wants from the specialist, in his words" },
      },
      required: ["name", "question"],
    },
  },
  {
    name: "start_coding_task",
    description: "Dispatch an OpenCode crewmate to build something, in the background: it gets its own git worktree and branch, works unattended, and Flyd verifies it with the repo's own tests and tells George when it is ready to land. Use for features, refactors, and multi-file work; small edits you can make directly. Returns immediately with a task id.",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", description: "The finished result, stated precisely enough to build and verify unattended" },
        done_when: { type: "array", items: { type: "string" }, description: "Checkable points that mean it's done, beyond tests passing (e.g. \"the TUI scrolls with the mouse wheel\", \"a test covers an empty inbox\"). An independent reviewer holds the diff to these." },
        repo: { type: "string", description: "Repository root path (default: the current project)" },
      },
      required: ["outcome", "done_when"],
    },
  },
  {
    name: "background_task",
    description: "Take on real work in the background while the conversation carries on: generate, draft, research, build, evaluate. Returns at once; the result comes back to George in the chat when done. Use it to act on something he cares about instead of only commenting — e.g. generate new DIR mixes and judge them. For code changes to a repo, prefer start_coding_task.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The job, stated fully: what to make or find, where, and how to judge the result" },
        done_when: { type: "array", items: { type: "string" }, description: "Checkable points that mean the job is done, in George's terms (e.g. \"three new mixes exist in DIR/mixes\", \"each is under 4 minutes\"). An independent check holds the result to these." },
        deliverable: { type: "string", description: "Optional file or folder the job must leave behind, checked on disk" },
      },
      required: ["task", "done_when"],
    },
  },
  {
    name: "crew",
    description: "Flyd's coding crew. action=list shows tasks and their status; show gives one task's summary, diff size, and checks; land merges a verified task into the branch it started from; discard deletes its worktree and branch. land and discard need George's approval.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "show", "land", "discard"], description: "What to do" },
        id: { type: "string", description: "Task id (show, land, discard)" },
      },
      required: ["action"],
    },
  },
];

export const ASSISTANT_TOOL_NAMES = new Set(assistantTools.map((tool) => tool.name));

export interface AssistantToolContext {
  presentHypothesis?: string | null;
  situation?: { project?: string; projectRoot?: string } | null;
  /** Called when the model hands a job to the coding runtime. */
  onCodingHandoff?: (outcome: string) => void;
}

function lines(text: unknown): string[] {
  return String(text ?? "").split(/\n|;/).map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter(Boolean);
}

export async function runAssistantTool(
  name: string,
  input: Record<string, unknown>,
  context: AssistantToolContext = {},
): Promise<string> {
  try {
    switch (name) {
      case "todos": {
        const todos = await import("../work/work-hypothesis/confirmed-todos.js");
        const describe = (items: Array<{ description: string; dueDate?: string | null }>) =>
          items.length ? items.map((item) => `- ${item.description}${item.dueDate ? ` (due ${item.dueDate})` : ""}`).join("\n") : "(no open to-dos)";
        if (input.action === "list") return describe(todos.listOpenConfirmedTodos());
        if (input.action === "add") {
          const added = todos.appendConfirmedTodos(lines(input.items));
          return `Added. Open to-dos now:\n${describe(added)}`;
        }
        if (input.action === "replace") {
          const replaced = todos.replaceConfirmedTodos(lines(input.items));
          return `To-do list replaced:\n${describe(replaced)}`;
        }
        if (input.action === "done") {
          const done = todos.completeConfirmedTodo(String(input.query ?? ""));
          return done ? `Completed: ${done.description}` : `Error: no open to-do matches "${String(input.query ?? "")}"`;
        }
        return "Error: todos action must be list, add, done, or replace";
      }
      case "work_model": {
        const statement = String(input.statement ?? "").trim();
        if (!statement) return "Error: work_model needs George's statement";
        const hypothesis = await import("../work/work-hypothesis/index.js");
        const options = { foregroundRoot: context.situation?.projectRoot, coreCwd: process.cwd() };
        const correction = hypothesis.parseHypothesisCorrection(statement);
        if (correction) {
          await hypothesis.applyHypothesisCorrection(statement, options);
          return hypothesis.formatHypothesisCorrectionReply(correction, context.presentHypothesis);
        }
        const mention = await hypothesis.handleWorkstreamMention(statement, options);
        if (mention) return mention;
        return "Error: could not read that as a work correction. Rephrase as e.g. \"I'm not working on X\", \"X is done\", or \"I'm also working on X\".";
      }
      case "speaking_style": {
        const style = input.style === "asd-ste100" ? "asd-ste100" : "default";
        const { writeSpeakingPreference } = await import("./speaking-preference.js");
        writeSpeakingPreference(style, "chat tool");
        return style === "asd-ste100"
          ? "Speaking style set to plain, literal Simplified Technical English from the next reply."
          : "Speaking style set back to default from the next reply.";
      }
      case "flyd": {
        const compound = await import("../work-intelligence/compound-nl.js");
        switch (input.action) {
          case "skills": return compound.buildSkillsInventoryReply();
          case "skillify": return compound.buildSkillifyProposeReply({});
          case "jobs_status": return compound.buildJobsStatusReply();
          case "run_briefing": return compound.buildJobsRunBriefingReply(String(input.project ?? "") || context.situation?.project);
          case "job_hunt": return compound.buildJobHuntStatusReply(context.presentHypothesis);
          case "improve": {
            const [{ runSelfImprovement }, { query }, { notifyMac }] = await Promise.all([
              import("../crew/self-improve.js"), import("../lib/llm.js"), import("./agenda.js"),
            ]);
            const feedback = String(input.feedback ?? "").trim();
            const result = await runSelfImprovement({
              complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
              notify: notifyMac,
              force: true,
              extraEvidence: feedback ? [{ id: `chat:${Date.now().toString(36)}`, kind: "pushback", at: new Date().toISOString(), text: `George said directly: "${feedback}"` }] : [],
            });
            if (result.status === "dispatched") return `Self-improvement started: ${result.improvement!.title}. It is built and tested on its own branch and lands only when George says /land. Tell him in plain words what you're changing about yourself; no ids.`;
            if (result.status === "awaiting_george") return "A self-improvement is already built and waiting for George's /land; tell him that one is ready first.";
            return `No change started (${result.status.replace(/_/g, " ")}). Tell him honestly and say what you'd need to see.`;
          }
          default: return "Error: flyd action must be skills, skillify, jobs_status, run_briefing, job_hunt, or improve";
        }
      }
      case "consult_specialist": {
        const { lookupSpecialist, listSpecialistNames } = await import("./specialist-registry.js");
        const specialist = lookupSpecialist(String(input.name ?? "").toLowerCase());
        if (!specialist) return `Error: no specialist "${String(input.name ?? "")}". Available: ${listSpecialistNames().join(", ") || "none"}`;
        const reply = await specialist.dispatch({
          message: String(input.question ?? ""),
          presentHypothesis: context.presentHypothesis,
          situation: context.situation ?? null,
        });
        return reply ?? `${specialist.name} had nothing to add.`;
      }
      case "start_coding_task": {
        const outcome = String(input.outcome ?? "").replace(/\s+/g, " ").trim();
        if (!outcome) return "Error: start_coding_task needs an outcome";
        const repo = String(input.repo ?? "").trim() || context.situation?.projectRoot || process.cwd();
        const { dispatchCrewTask } = await import("../crew/crew.js");
        const { normalizeCriteria } = await import("./acceptance.js");
        const doneWhen = normalizeCriteria(input.done_when);
        if (!doneWhen.length) return "Error: start_coding_task needs done_when: the checkable points that mean it's done";
        const task = await dispatchCrewTask({ repo, outcome, doneWhen, source: "chat" });
        return `Started in the background (task ${task.id}). It is built and tested on its own branch, George is notified when it is ready, and it merges only when he says /land. Tell him in your own words; don't mention crewmates, branches, or worktrees.`;
      }
      case "background_task": {
        const jobs = await import("./background-jobs.js");
        const contract = jobs.normalizeContract(input);
        if (typeof contract === "string") return `Error: ${contract}`;
        const id = jobs.startBackgroundJob(contract, { run: jobs.runJobTurn, verify: jobs.verifyJobTurn, deliver: jobs.deliverJob });
        return `Started in the background (job ${id}). The result will come back to George in the chat when it's done. Tell him in a few words what you're doing; don't mention job ids.`;
      }
      case "crew": {
        const crew = await import("../crew/crew.js");
        const id = String(input.id ?? "").trim();
        if (input.action === "list") {
          const tasks = crew.listTasks().slice(0, 10);
          return tasks.length ? tasks.map(crew.describeTask).join("\n") : "No crew tasks yet.";
        }
        if (!id) return "Error: crew show/land/discard needs an id";
        if (input.action === "show") {
          const task = crew.readTask(id);
          if (!task) return `Error: no crew task ${id}`;
          return [
            crew.describeTask(task),
            task.summary ? `Crewmate's summary: ${task.summary}` : "",
            ...(task.verification ?? []).map((step) => `${step.ok ? "✓" : "✗"} ${step.command}${step.ok ? "" : `\n${step.tail}`}`),
            ...(task.review?.length ? ["Independent review against what was asked:", ...crew.reviewLines(task)] : []),
          ].filter(Boolean).join("\n");
        }
        if (input.action === "land") return crew.describeTask(await crew.landCrewTask(id));
        if (input.action === "discard") return crew.describeTask(await crew.discardCrewTask(id));
        return "Error: crew action must be list, show, land, or discard";
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
