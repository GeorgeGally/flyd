import { randomUUID } from 'node:crypto';
import { query } from '../lib/llm.js';
import type { FileReadResult, FileGrepResult, FileWriteResult } from './file-operations.js';
import type { ShellExecutionResult } from './types.js';

export type TaskStepKind = 'read_file' | 'grep' | 'write_file' | 'shell_command' | 'verify';

const VALID_STEP_KINDS = new Set<string>(['read_file', 'grep', 'write_file', 'shell_command', 'verify']);

export interface TaskStep {
  stepId: string;
  kind: TaskStepKind;
  description: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: TaskStepResult;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskStepResult {
  kind: TaskStepKind;
  summary: string;
  data?: FileReadResult | FileGrepResult | FileWriteResult | ShellExecutionResult;
  error?: string;
}

export interface TaskPlan {
  planId: string;
  intent: string;
  context: string;
  steps: TaskStep[];
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
}

const TASK_PLAN_PROMPT = `You are Flyd's task planner. The user has invoked you with a specific intent to accomplish in their codebase. Plan a sequence of steps using the available tools.

AVAILABLE STEPS:
- read_file: Read a file's contents. Params: { path: string, startLine?: number, endLine?: number }
- grep: Search the codebase. Params: { pattern: string, filePattern?: string }
- write_file: Create or overwrite a file. Params: { path: string, content: string }
- shell_command: Run a shell command. Params: { command: string, workingDirectory?: string, explanation: string, isDestructive?: boolean }
- verify: Check that the previous steps achieved the intended outcome.

RULES:
- Start with read_file or grep to understand the codebase before writing.
- Each step description should explain WHY this step is needed.
- Shell commands should have a clear explanation of what they do.
- End with a verify step that checks the outcome.
- Keep plans to 3-8 steps. Don't over-engineer.
- If the task is a simple question, just use read_file or grep.
- If the task asks to fix or create, use read → write → verify.
- Only use the five tools listed above. Never invent new tool names.

Respond with ONLY a JSON object:
{
  "thought": "<one-sentence summary of your plan>",
  "steps": [
    {
      "kind": "<read_file|grep|write_file|shell_command|verify>",
      "description": "<why this step>",
      "params": { ... }
    }
  ]
}`;

export function buildTaskPlanPrompt(params: {
  intent: string;
  projectRoot: string;
  currentWork: string;
  context?: string;
}): string {
  return `${TASK_PLAN_PROMPT}

<user_intent>
${params.intent}
</user_intent>

<project_root>${params.projectRoot}</project_root>

<current_work>
${params.currentWork}
</current_work>${params.context ? `\n<extra_context>\n${params.context}\n</extra_context>` : ''}`;
}

export function parseTaskPlan(raw: string): { thought: string; steps: TaskStep[] } | null {
  let jsonStr = raw.trim();

  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const thought = (parsed.thought as string) || '';

    if (!Array.isArray(parsed.steps)) return null;
    if ((parsed.steps as unknown[]).length === 0) return null;

    const steps: TaskStep[] = [];
    for (let i = 0; i < (parsed.steps as unknown[]).length; i++) {
      const s = (parsed.steps as Record<string, unknown>[])[i];
      const kind = s.kind as string;

      if (!kind || !VALID_STEP_KINDS.has(kind)) {
        return null;
      }

      steps.push({
        stepId: `step-${i + 1}`,
        kind: kind as TaskStepKind,
        description: (s.description as string) || `Step ${i + 1}`,
        params: (s.params as Record<string, unknown>) || {},
        status: 'pending' as const,
      });
    }

    return { thought, steps };
  } catch {
    return null;
  }
}

export async function planTask(params: {
  intent: string;
  projectRoot: string;
  currentWork: string;
  context?: string;
  modelConfig: { model: string; apiKey: string; baseURL: string };
}): Promise<TaskPlan | null> {
  const prompt = buildTaskPlanPrompt({
    intent: params.intent,
    projectRoot: params.projectRoot,
    currentWork: params.currentWork,
    context: params.context,
  });

  const raw = await query(
    prompt,
    params.modelConfig.model,
    undefined,
    params.modelConfig.apiKey,
    params.modelConfig.baseURL,
    { json: true }
  );

  const parsed = parseTaskPlan(raw);
  if (!parsed) return null;

  return {
    planId: randomUUID(),
    intent: params.intent,
    context: params.currentWork,
    steps: parsed.steps,
    status: 'planning',
    startedAt: new Date().toISOString(),
  };
}

const VERIFY_PROMPT = `You are verifying the outcome of a multi-step task in a codebase. Given the task intent, the steps that were executed, and their results, determine whether the task was successful.

<intent>__INTENT__</intent>

__STEPS_SUMMARY__

Respond with ONLY a JSON object:
{
  "verdict": "<success|partial|failed>",
  "summary": "<what happened, what changed, what still needs attention>",
  "unresolved_items": ["<item that still needs work>"],
  "next_action": "<recommended next step or null if complete>"
}`;

export function buildVerifyPrompt(task: TaskPlan): string {
  const parts: string[] = [];

  for (const s of task.steps) {
    if (s.status === 'pending') {
      parts.push(`[${s.kind}] ${s.description}: NOT EXECUTED (still pending)`);
    } else if (s.status === 'skipped') {
      parts.push(`[${s.kind}] ${s.description}: SKIPPED (deliberately not executed)`);
    } else if (s.status === 'running') {
      parts.push(`[${s.kind}] ${s.description}: STILL RUNNING (execution in progress)`);
    } else {
      const result = s.result?.error
        ? `ERROR: ${s.result.error}`
        : s.result?.summary || 'No output';
      parts.push(`[${s.kind}] ${s.description}: ${result}`);
    }
  }

  const stepsSummary = parts.length > 0
    ? `<executed_steps>\n${parts.join('\n')}\n</executed_steps>`
    : '<executed_steps>No steps executed</executed_steps>';

  return VERIFY_PROMPT
    .replace('__INTENT__', task.intent)
    .replace('__STEPS_SUMMARY__', stepsSummary);
}
