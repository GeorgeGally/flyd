import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { SKILLS_DIR, RAW_DIR, PROJECT, defaultModel } from "./config.js";
import { parse, serialize } from "./frontmatter.js";
import { query } from "./llm.js";

export interface Skill {
  name: string;
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface Task {
  query: string;
}

export interface TaskSet {
  training: Task[];
  heldOut: Task[];
  rubric: string;
  generatedAt: string;
}

export interface Score {
  taskCompletion: number;
  skillAdherence: number;
  outputQuality: number;
  overall: number;
}

export interface PerTaskScore {
  task: Task;
  response: string;
  scores: Score;
}

export interface Evaluation {
  perTask: PerTaskScore[];
  aggregate: Score;
  cost: number;
}

export interface Proposal {
  content: string;
  cost: number;
}

export interface ValidationResult {
  accepted: boolean;
  preScore: number;
  postScore: number;
  delta: number;
  cost: number;
}

export interface HistoryEntry {
  version: number;
  skill: string;
  timestamp: string;
  accepted: boolean;
  preScore: number;
  postScore: number;
  cost: number;
}

export interface OptimizationOptions {
  iterations: number;
  executorModel: string;
  judgeModel: string;
  optimizerModel: string;
  dryRun: boolean;
  noCache: boolean;
}

export interface OptimizationResult {
  skill: string;
  version: number;
  accepted: boolean;
  preScore: number;
  postScore: number;
  heldOutPreScore: number;
  heldOutPostScore: number;
  iterations: number;
  cost: number;
  timestamp: string;
}

const TASK_CALL_COST = 0.01;
const JUDGE_CALL_COST = 0.01;
const OPTIMIZER_CALL_COST = 0.30;
const GENERATE_CALL_COST = 0.30;

export function loadSkill(name: string): Skill {
  const skillPath = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(skillPath)) {
    const available = listSkills().map(s => `  - ${s}`).join("\n");
    throw new Error(`Skill "${name}" not found. Available skills:\n${available}`);
  }
  const content = readFileSync(skillPath, "utf8");
  const { metadata, body } = parse(content);
  return { name, path: skillPath, content, frontmatter: metadata };
}

export function listSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, "SKILL.md")))
    .map(d => d.name);
}

function skillHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function splitTasks(queries: string[], rubric: string, hash: number): TaskSet {
  const heldOutCount = Math.max(2, Math.ceil(queries.length * 0.2));
  const allTasks = queries.map(q => ({ query: q }));
  const heldOut: Task[] = [];
  const training: Task[] = [];
  for (let i = 0; i < allTasks.length; i++) {
    if (i < heldOutCount) {
      heldOut.push(allTasks[i]);
    } else {
      training.push(allTasks[i]);
    }
  }
  // Shuffle deterministically by hash
  const seededRandom = (max: number) => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash % max;
  };
  for (let i = training.length - 1; i > 0; i--) {
    const j = seededRandom(i + 1);
    [training[i], training[j]] = [training[j], training[i]];
  }
  return { training, heldOut, rubric, generatedAt: new Date().toISOString() };
}

export async function generateTaskSet(skill: Skill, model: string): Promise<TaskSet> {
  const prompt = `You are generating test queries for an AI assistant skill.

SKILL NAME: ${skill.name}
SKILL DESCRIPTION: ${skill.frontmatter.description ?? ""}
SKILL CONTENT:
${skill.content}

Generate 10 realistic user queries this skill should handle well. These should be diverse and cover different aspects of the skill's purpose.

Also generate a scoring rubric — a short paragraph describing what makes a "good" response for a skill like this. What should a high-quality response include? Be specific.

Return raw JSON only (no markdown, no code fences):
{"queries": ["query1", "query2", ...], "rubric": "rubric text"}`;

  const raw = await query(prompt, model);
  let parsed: { queries?: string[]; rubric?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    const extracted = raw.match(/\{[^]*\}/);
    if (!extracted) throw new Error("Failed to parse task generation output");
    parsed = JSON.parse(extracted[0]);
  }
  const queries = parsed.queries ?? [];
  const rubric = parsed.rubric ?? `Respond to the user query accurately and helpfully, following the skill's purpose.`;
  if (queries.length < 4) throw new Error(`Generated only ${queries.length} queries — need at least 4`);
  const hash = skillHash(skill.name);
  return splitTasks(queries, rubric, hash);
}

function taskSetPath(skillName: string): string {
  return join(SKILLS_DIR, skillName, "tasks.json");
}

export function loadTaskSet(skillName: string): TaskSet | null {
  const path = taskSetPath(skillName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TaskSet;
  } catch {
    return null;
  }
}

export function saveTaskSet(skillName: string, tasks: TaskSet): void {
  writeFileSync(taskSetPath(skillName), JSON.stringify(tasks, null, 2), "utf8");
}

export async function cachedTaskSet(skill: Skill, model: string, noCache: boolean): Promise<TaskSet> {
  if (!noCache) {
    const existing = loadTaskSet(skill.name);
    if (existing) return existing;
  }
  const fresh = await generateTaskSet(skill, model);
  saveTaskSet(skill.name, fresh);
  return fresh;
}

export function averageScore(scores: Score[]): Score {
  if (scores.length === 0) return { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 };
  const sum = scores.reduce((a, s) => ({
    taskCompletion: a.taskCompletion + s.taskCompletion,
    skillAdherence: a.skillAdherence + s.skillAdherence,
    outputQuality: a.outputQuality + s.outputQuality,
    overall: a.overall + s.overall,
  }), { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 });
  const n = scores.length;
  return {
    taskCompletion: sum.taskCompletion / n,
    skillAdherence: sum.skillAdherence / n,
    outputQuality: sum.outputQuality / n,
    overall: sum.overall / n,
  };
}

const JUDGE_PROMPT = `You are evaluating how well an AI assistant followed its skill instructions to respond to a user query.

SKILL:
{{skill}}

USER QUERY:
{{query}}

RESPONSE:
{{response}}

EVALUATION RUBRIC:
{{rubric}}

Rate the response on three dimensions from 0.0 to 1.0:
- taskCompletion: Did it actually answer the user's question?
- skillAdherence: Did it follow the skill's instructions?
- outputQuality: Is the response specific, well-structured, and useful?

Return ONLY a valid JSON object, no other text:
{"taskCompletion": 0.0, "skillAdherence": 0.0, "outputQuality": 0.0}`;

const EXECUTOR_PROMPT = `SKILL INSTRUCTIONS:
{{skill}}

---
User: {{query}}
---
Respond to the user following the skill instructions above.`;

async function executeTask(skill: Skill, task: Task, model: string): Promise<string> {
  const prompt = EXECUTOR_PROMPT
    .replace("{{skill}}", skill.content)
    .replace("{{query}}", task.query);
  return await query(prompt, model);
}

async function judgeResponse(skill: Skill, task: Task, response: string, rubric: string, model: string): Promise<Score> {
  const prompt = JUDGE_PROMPT
    .replace("{{skill}}", skill.content)
    .replace("{{query}}", task.query)
    .replace("{{response}}", response)
    .replace("{{rubric}}", rubric);
  const raw = await query(prompt, model);
  try {
    const parsed = JSON.parse(raw);
    const tc = Math.max(0, Math.min(1, parsed.taskCompletion ?? 0));
    const sa = Math.max(0, Math.min(1, parsed.skillAdherence ?? 0));
    const oq = Math.max(0, Math.min(1, parsed.outputQuality ?? 0));
    const overall = (tc + sa + oq) / 3;
    return { taskCompletion: tc, skillAdherence: sa, outputQuality: oq, overall };
  } catch {
    return { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 };
  }
}

export async function evaluateSkill(skill: Skill, tasks: Task[], rubric: string, executorModel: string, judgeModel: string): Promise<Evaluation> {
  const perTask: PerTaskScore[] = [];
  let cost = 0;
  for (const task of tasks) {
    const response = await executeTask(skill, task, executorModel);
    cost += TASK_CALL_COST;
    const scores = await judgeResponse(skill, task, response, rubric, judgeModel);
    cost += JUDGE_CALL_COST;
    perTask.push({ task, response, scores });
  }
  const aggregate = averageScore(perTask.map(p => p.scores));
  return { perTask, aggregate, cost };
}

export async function proposeRewrite(skill: Skill, evaluation: Evaluation, optimizerModel: string): Promise<Proposal> {
  const taskResults = evaluation.perTask.map(p =>
    `Query: ${p.task.query}\nScore: ${p.scores.overall.toFixed(2)}\nResponse: ${p.response.slice(0, 500)}`
  ).join("\n\n---\n\n");

  const prompt = `You are optimizing a skill — a set of instructions that guides how an AI assistant behaves.

CURRENT SKILL (with frontmatter):
${skill.content}

The skill was tested on ${evaluation.perTask.length} tasks. Here are the results:

${taskResults}

OVERALL SCORE: ${evaluation.aggregate.overall.toFixed(3)}
SCORE BREAKDOWN:
- taskCompletion: ${evaluation.aggregate.taskCompletion.toFixed(3)}
- skillAdherence: ${evaluation.aggregate.skillAdherence.toFixed(3)}
- outputQuality: ${evaluation.aggregate.outputQuality.toFixed(3)}

Propose an improved version of this skill. Fix the weaknesses shown by the scores.
Rules:
- Keep the same frontmatter format (name:, description:)
- The body should be clear markdown instructions
- Do NOT add code fences around the output
- Focus on practical improvements that would raise the scores

Output ONLY the full skill content including frontmatter.`;

  const content = await query(prompt, optimizerModel);
  // Validate it has valid frontmatter
  const parsed = parse(content);
  if (!parsed.metadata.name) {
    throw new Error("Optimizer produced invalid skill — no name in frontmatter");
  }
  if (!parsed.body.trim()) {
    throw new Error("Optimizer produced empty skill body");
  }
  return { content, cost: OPTIMIZER_CALL_COST };
}

export async function validateRewrite(
  original: Skill,
  proposed: string,
  heldOut: Task[],
  rubric: string,
  executorModel: string,
  judgeModel: string,
): Promise<ValidationResult> {
  const proposedSkill: Skill = {
    ...original,
    content: proposed,
  };
  const pre = await evaluateSkill(original, heldOut, rubric, executorModel, judgeModel);
  const post = await evaluateSkill(proposedSkill, heldOut, rubric, executorModel, judgeModel);
  const delta = post.aggregate.overall - pre.aggregate.overall;
  const accepted = delta > 0.01;
  return {
    accepted,
    preScore: pre.aggregate.overall,
    postScore: post.aggregate.overall,
    delta,
    cost: pre.cost + post.cost,
  };
}

export function getNextVersion(skillName: string): number {
  const historyDir = join(SKILLS_DIR, skillName, "history");
  if (!existsSync(historyDir)) return 0;
  const dirs = readdirSync(historyDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d+$/.test(d.name))
    .map(d => parseInt(d.name.slice(1), 10));
  return dirs.length > 0 ? Math.max(...dirs) + 1 : 0;
}

export function saveHistory(skillName: string, version: number, data: {
  skillContent: string;
  preScores: Evaluation;
  postScores: Evaluation | null;
  validation: ValidationResult;
  cost: number;
  accepted: boolean;
}): void {
  const dir = join(SKILLS_DIR, skillName, "history", `v${version}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "skill.md"), data.skillContent, "utf8");
  writeFileSync(join(dir, "pre-scores.json"), JSON.stringify({
    aggregate: data.preScores.aggregate,
    perTask: data.preScores.perTask.map(p => ({
      query: p.task.query,
      scores: p.scores,
    })),
  }, null, 2), "utf8");
  if (data.postScores) {
    writeFileSync(join(dir, "post-scores.json"), JSON.stringify({
      aggregate: data.postScores.aggregate,
      perTask: data.postScores.perTask.map(p => ({
        query: p.task.query,
        scores: p.scores,
      })),
    }, null, 2), "utf8");
  }
  writeFileSync(join(dir, "report.json"), JSON.stringify({
    version,
    skill: skillName,
    timestamp: new Date().toISOString(),
    accepted: data.accepted,
    preScore: data.validation.preScore,
    postScore: data.validation.postScore,
    delta: data.validation.delta,
    cost: data.cost,
  }, null, 2), "utf8");
}

export function loadHistory(skillName: string): HistoryEntry[] {
  const historyDir = join(SKILLS_DIR, skillName, "history");
  if (!existsSync(historyDir)) return [];
  const dirs = readdirSync(historyDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d+$/.test(d.name))
    .sort((a, b) => parseInt(a.name.slice(1), 10) - parseInt(b.name.slice(1), 10));
  const entries: HistoryEntry[] = [];
  for (const d of dirs) {
    const reportPath = join(historyDir, d.name, "report.json");
    if (!existsSync(reportPath)) continue;
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      entries.push({
        version: report.version,
        skill: report.skill,
        timestamp: report.timestamp,
        accepted: report.accepted,
        preScore: report.preScore,
        postScore: report.postScore,
        cost: report.cost,
      });
    } catch { /* skip corrupt reports */ }
  }
  return entries;
}

async function captureReport(result: OptimizationResult): Promise<void> {
  mkdirSync(RAW_DIR, { recursive: true });
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const filename = ts.replace(/[ :]/g, "-") + ".md";
  const body = [
    `# Skill Optimization: ${result.skill}`,
    "",
    `Version ${result.version} — ${result.accepted ? "Accepted" : "Rejected"}`,
    "",
    `- Overall score: ${result.preScore.toFixed(3)} → ${result.postScore.toFixed(3)}`,
    `- Held-out score: ${result.heldOutPreScore.toFixed(3)} → ${result.heldOutPostScore.toFixed(3)}`,
    `- Iterations: ${result.iterations}`,
    `- Cost: \$${result.cost.toFixed(2)}`,
    "",
    result.accepted
      ? `The rewritten skill was accepted with a gain of ${(result.postScore - result.preScore).toFixed(3)} points on held-out tasks.`
      : `The rewrite was rejected — held-out score did not improve sufficiently.`,
  ].join("\n");
  const content = serialize({
    source: "flyd",
    type: "optimization-report",
    project: PROJECT.name,
    project_path: PROJECT.path,
    timestamp: ts,
    skill: result.skill,
    version: result.version,
    accepted: result.accepted,
    pre_score: result.preScore,
    post_score: result.postScore,
    held_out_pre: result.heldOutPreScore,
    held_out_post: result.heldOutPostScore,
    cost: result.cost,
  }, body);
  writeFileSync(join(RAW_DIR, filename), content, "utf8");
}

export async function runSkillOptimization(name: string, opts: OptimizationOptions): Promise<OptimizationResult> {
  const skill = loadSkill(name);
  const ts = new Date().toISOString();

  const taskSet = await cachedTaskSet(skill, opts.optimizerModel, opts.noCache);
  const version = getNextVersion(skill.name);
  let totalCost = 0;
  let currentContent = skill.content;
  let accepted = false;
  let finalPreScore = 0;
  let finalPostScore = 0;
  let heldOutPreScore = 0;
  let heldOutPostScore = 0;

  for (let i = 0; i < opts.iterations; i++) {
    const preEval = await evaluateSkill(
      { ...skill, content: currentContent },
      taskSet.training,
      taskSet.rubric,
      opts.executorModel,
      opts.judgeModel,
    );
    totalCost += preEval.cost;

    const proposal = await proposeRewrite(
      { ...skill, content: currentContent },
      preEval,
      opts.optimizerModel,
    );
    totalCost += proposal.cost;

    const validation = await validateRewrite(
      { ...skill, content: currentContent },
      proposal.content,
      taskSet.heldOut,
      taskSet.rubric,
      opts.executorModel,
      opts.judgeModel,
    );
    totalCost += validation.cost;

    const postEval = validation.accepted
      ? await evaluateSkill(
          { ...skill, content: proposal.content },
          taskSet.heldOut,
          taskSet.rubric,
          opts.executorModel,
          opts.judgeModel,
        )
      : null;

    if (!opts.dryRun) {
      saveHistory(skill.name, version, {
        skillContent: proposal.content,
        preScores: preEval,
        postScores: postEval,
        validation,
        cost: totalCost,
        accepted: validation.accepted,
      });
    }

    if (validation.accepted) {
      currentContent = proposal.content;
      accepted = true;
      finalPreScore = validation.preScore;
      finalPostScore = validation.postScore;
      heldOutPreScore = validation.preScore;
      heldOutPostScore = validation.postScore;
      console.log(`  iteration ${i + 1}: accepted — ${validation.preScore.toFixed(3)} → ${validation.postScore.toFixed(3)} (delta ${validation.delta.toFixed(3)})`);
    } else {
      finalPreScore = validation.preScore;
      finalPostScore = validation.postScore;
      console.log(`  iteration ${i + 1}: rejected — held-out score ${validation.preScore.toFixed(3)} → ${validation.postScore.toFixed(3)} (no improvement)`);
    }

    if (!opts.dryRun && accepted) {
      writeFileSync(skill.path, proposal.content, "utf8");
    }
  }

  const result: OptimizationResult = {
    skill: name,
    version,
    accepted,
    preScore: finalPreScore,
    postScore: finalPostScore,
    heldOutPreScore,
    heldOutPostScore,
    iterations: opts.iterations,
    cost: totalCost,
    timestamp: ts,
  };

  if (!opts.dryRun) {
    await captureReport(result);
  }

  return result;
}
