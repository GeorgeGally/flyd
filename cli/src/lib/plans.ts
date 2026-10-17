import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { PLANS_DIR } from "./config.js";
import { parse } from "./frontmatter.js";

// Plans are plain markdown files in the plans folder, mirrored into the capture
// archive so the existing search finds them. This module only reads them back:
// there is no new store, ranking or governance layer. The body follows a fixed
// shape (outcome, files to touch, approval gates, and per-phase steps with
// checkable done_when points) that the reader understands.

export interface PlanPhase {
  title: string;
  steps: string[];
  /** Checkable points that mean the phase is done — the same list the done_when gate checks. */
  doneWhen: string[];
}

export interface Plan {
  path: string;
  filename: string;
  topic: string;
  status: string;
  /** The project name, and the repository folder the plan belongs to. */
  project: string;
  repoPath: string;
  /** The created date, as recorded in the frontmatter. */
  created: string;
  outcome: string;
  files: string[];
  /** Steps that happen only with George's approval, landing included. */
  approvalGates: string[];
  phases: PlanPhase[];
  body: string;
}

const HEADING = /^##\s+(.*)$/;
const PHASE = /^##\s+phase\s+\d+\s*[—:-]?\s*(.*)$/i;
const CHECKBOX = /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/;
const BULLET = /^\s*[-*]\s+(.+)$/;
const DONE_WHEN = /^\s*(?:\*\*)?\s*done\s+when\s*:?\s*(?:\*\*)?\s*$/i;

/** The body of a plan file, read into the fixed shape the plan is written in. Pure. */
export function parsePlanBody(body: string): Pick<Plan, "outcome" | "files" | "approvalGates" | "phases"> {
  const outcome: string[] = [];
  const files: string[] = [];
  const approvalGates: string[] = [];
  const phases: PlanPhase[] = [];
  let section = "";
  let phase: PlanPhase | null = null;
  let inDoneWhen = false;

  for (const line of body.split("\n")) {
    const phaseMatch = line.match(PHASE);
    if (phaseMatch) {
      phase = { title: phaseMatch[1]!.trim(), steps: [], doneWhen: [] };
      phases.push(phase);
      section = "phase";
      inDoneWhen = false;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const name = heading[1]!.trim().toLowerCase();
      section = name.startsWith("outcome") ? "outcome"
        : name.startsWith("file") ? "files"
          : name.startsWith("approval") ? "approval"
            : "";
      phase = null;
      inDoneWhen = false;
      continue;
    }
    if (DONE_WHEN.test(line) && phase) {
      inDoneWhen = true;
      continue;
    }
    if (section === "outcome" && line.trim() && !line.startsWith("#")) outcome.push(line.trim());
    if (section === "files") {
      const bullet = line.match(BULLET);
      if (bullet) files.push(bullet[1]!.trim());
    }
    if (section === "approval") {
      const check = line.match(CHECKBOX) ?? line.match(BULLET);
      if (check) approvalGates.push(check[1]!.trim());
    }
    if (section === "phase" && phase) {
      const item = line.match(CHECKBOX) ?? line.match(BULLET);
      if (item) (inDoneWhen ? phase.doneWhen : phase.steps).push(item[1]!.trim());
      else if (!inDoneWhen && line.trim() && !line.startsWith("#")) phase.steps.push(line.trim());
    }
  }

  return { outcome: outcome.join(" ").trim(), files, approvalGates, phases };
}

/** Every plan in the folder, newest first. Missing folder or unreadable file gives fewer plans, never a throw. */
export function readPlans(dir: string = PLANS_DIR): Plan[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .reverse()
    .flatMap((file) => {
      try {
        return [readPlan(join(dir, file), file)];
      } catch {
        return [];
      }
    });
}

function readPlan(path: string, filename: string): Plan {
  const content = readFileSync(path, "utf8");
  const { metadata, body } = parse(content);
  const parsed = parsePlanBody(body);
  return {
    path,
    filename,
    topic: String(metadata.topic ?? filename.replace(/\.md$/, "")),
    status: String(metadata.status ?? "draft"),
    project: String(metadata.project ?? ""),
    repoPath: String(metadata.repo_path ?? metadata.project_path ?? ""),
    created: String(metadata.created ?? metadata.timestamp ?? ""),
    ...parsed,
    body,
  };
}

/** The plan a query names, by filename or topic, case-insensitive. */
export function findPlan(query: string, dir: string = PLANS_DIR): Plan | undefined {
  const plans = readPlans(dir);
  const q = query.toLowerCase();
  return plans.find((plan) => plan.filename.toLowerCase().includes(q))
    ?? plans.find((plan) => plan.topic.toLowerCase().includes(q));
}

/** What a fresh coding session is given: the plan's task, its files, its repo folder, and its done_when. */
export interface PlanHandoff {
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  project: { name?: string; root: string };
}

/** The handoff a plan produces. Pure: it decides nothing about whether to start. */
export function planHandoff(plan: Plan): PlanHandoff {
  const outcome = plan.outcome || plan.topic;
  const first = plan.phases[0];
  const phase = first ? `\n\nPhase 1${first.title ? ` — ${first.title}` : ""}:${first.steps.map((step) => `\n- ${step}`).join("")}` : "";
  const files = plan.files.length ? `\n\nFiles to touch:\n${plan.files.map((file) => `- ${file}`).join("\n")}` : "";
  return {
    originalMessage: plan.topic,
    intendedOutcome: `${outcome}${phase}${files}`,
    // Start with the first phase's points; a phase-less plan hands over every point it has.
    doneWhen: plan.phases[0]?.doneWhen.length ? plan.phases[0].doneWhen : plan.phases.flatMap((phase) => phase.doneWhen),
    project: { ...(plan.project ? { name: plan.project } : {}), root: plan.repoPath },
  };
}
