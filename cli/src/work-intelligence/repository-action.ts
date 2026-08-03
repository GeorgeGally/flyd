import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFlydWorkerConfig } from '../runtime/flyd-worker-config.js';
import { createFlydWorkerAdapter, parseFlydWorkerEvent } from '../runtime/flyd-worker-adapter.js';
import type { WorkerRunResult } from '../runtime/worker-adapter.js';

export interface RepositoryActionInput {
  approvedRoot: string;
  instruction: string;
  finishCondition: string;
  workSessionRevision: number;
  workingBranch?: string;
  timeoutMs?: number;
}

export interface RepositoryActionResult {
  actionId: string;
  verified: boolean;
  rootPreserved: boolean;
  diffPresent: boolean;
  artifactPresent: boolean;
  output: string;
  error?: string;
  changedFiles: string[];
  diffSummary?: string;
  exitStatus: number;
}

export async function runRepositoryAction(input: RepositoryActionInput): Promise<RepositoryActionResult> {
  const actionId = randomUUID();

  if (!existsSync(input.approvedRoot)) {
    return {
      actionId,
      verified: false,
      rootPreserved: false,
      diffPresent: false,
      artifactPresent: false,
      output: '',
      error: `Repository root does not exist: ${input.approvedRoot}`,
      changedFiles: [],
      exitStatus: -1,
    };
  }

  const config = loadFlydWorkerConfig();
  const sessionRoot = join(tmpdir(), 'flyd-repo-action', actionId);

  const adapter = createFlydWorkerAdapter({
    config,
    sessionRoot,
    repositoryRoots: [input.approvedRoot],
    fileOperations: ['read', 'write'],
    commandClasses: ['inspect', 'test', 'lint', 'git_status', 'git_diff'],
  });

  const health = await adapter.detect();
  if (!health.healthy) {
    return {
      actionId,
      verified: false,
      rootPreserved: false,
      diffPresent: false,
      artifactPresent: false,
      output: '',
      error: `Worker not healthy: ${health.error || 'unknown'}`,
      changedFiles: [],
      exitStatus: -1,
    };
  }

  const assignment = `## Objective\n${input.instruction}\n\n## Finish Condition\n${input.finishCondition}\n\n## Root\n${input.approvedRoot}`;

  const args = adapter.buildArgs({
    assignment,
    projectRoot: input.approvedRoot,
    taskKey: `repo-action-${actionId.slice(0, 8)}`,
    readOnly: false,
  });

  try {
    const result = await adapter.run({
      executable: process.execPath,
      args,
      cwd: input.approvedRoot,
      timeoutMs: input.timeoutMs || 300000,
      inactivityTimeoutMs: 120000,
      onEvent(_event) {},
    });

    const verified = result.exitStatus === 0 && result.output.length > 0;
    const hasDiff = result.output.includes('diff --git') || result.output.includes('diff');
    const hasArtifact = result.output.length > 50;

    return {
      actionId,
      verified,
      rootPreserved: true,
      diffPresent: hasDiff,
      artifactPresent: hasArtifact,
      output: result.output.slice(0, 8000),
      error: result.error || undefined,
      changedFiles: extractChangedFiles(result.output),
      diffSummary: hasDiff ? result.output.slice(0, 1000) : undefined,
      exitStatus: result.exitStatus,
    };
  } catch (err) {
    return {
      actionId,
      verified: false,
      rootPreserved: true,
      diffPresent: false,
      artifactPresent: false,
      output: '',
      error: `Worker execution failed: ${(err as Error).message}`,
      changedFiles: [],
      exitStatus: -1,
    };
  }
}

function extractChangedFiles(output: string): string[] {
  const files = new Set<string>();
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^(?:---|\+\+\+) [ab]\/(.+)$/);
    if (match) files.add(match[1]);
  }
  return Array.from(files).slice(0, 20);
}

export function validateRepositoryActionInput(input: RepositoryActionInput): string | null {
  if (!input.approvedRoot || typeof input.approvedRoot !== 'string') {
    return 'Missing approved root';
  }
  if (!input.instruction || input.instruction.trim().length === 0) {
    return 'Missing instruction';
  }
  if (input.instruction.length > 4000) {
    return 'Instruction too long';
  }
  if (!existsSync(input.approvedRoot)) {
    return `Root does not exist: ${input.approvedRoot}`;
  }
  if (!existsSync(join(input.approvedRoot, '.git'))) {
    return `Not a git repository: ${input.approvedRoot}`;
  }
  return null;
}
