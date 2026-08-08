import { existsSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadFlydWorkerConfig } from '../runtime/flyd-worker-config.js';
import { createFlydWorkerAdapter, verifyRepositoryActionDependencyBoundary } from '../runtime/flyd-worker-adapter.js';
import { inspectRepository, captureActionGrantFingerprint, fingerprintStillMatches, isCleanForIntegration } from '../runtime/repository-inspector.js';
import { filesOutsideScope } from '../runtime/result-verifier.js';
import { GitWorktreeManager } from '../runtime/worktree-manager.js';
import { fileURLToPath } from 'node:url';

export interface RepositoryActionInput {
  approvedRoot: string;
  instruction: string;
  finishCondition: string;
  workSessionRevision: number;
  actionGrantId?: string;
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
  diffDigest?: string;
  diffSummary?: string;
  exitStatus: number;
  checksPerformed: string[];
  isolatedWorktree?: boolean;
  integrated?: boolean;
  integrationStatus?: string;
  handoffLocation?: string;
}

const FORBIDDEN_MODULES = [
  'task-store',
  'orchestrator',
  'runtime-bridge',
  'rails',
  'attention',
  'delegation-event',
  'provider-routing',
];

export function verifyModuleDependencyBoundary(): { ok: boolean; violations: string[] } {
  try {
    const sourcePath = fileURLToPath(import.meta.url);
    const source = readFileSync(sourcePath, 'utf-8');
    return verifyRepositoryActionDependencyBoundary(source);
  } catch {
    return { ok: false, violations: ['Could not read module source for boundary check'] };
  }
}

export async function runRepositoryAction(input: RepositoryActionInput): Promise<RepositoryActionResult> {
  const actionId = randomUUID();

  validateRepositoryActionInput(input);

  const boundaryCheck = verifyModuleDependencyBoundary();
  if (!boundaryCheck.ok) {
    return {
      actionId,
      verified: false,
      rootPreserved: false,
      diffPresent: false,
      artifactPresent: false,
      output: '',
      error: `Dependency boundary violation: ${boundaryCheck.violations.join('; ')}`,
      changedFiles: [],
      exitStatus: -1,
      checksPerformed: ['dependency-boundary'],
    };
  }

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
      checksPerformed: ['root-exists'],
    };
  }

  if (!existsSync(join(input.approvedRoot, '.git'))) {
    return {
      actionId,
      verified: false,
      rootPreserved: false,
      diffPresent: false,
      artifactPresent: false,
      output: '',
      error: `Not a git repository: ${input.approvedRoot}`,
      changedFiles: [],
      exitStatus: -1,
      checksPerformed: ['root-exists', 'git-check'],
    };
  }

  const fingerprint = await captureActionGrantFingerprint(input.approvedRoot).catch(() => null);
  if (!fingerprint) {
    return {
      actionId,
      verified: false,
      rootPreserved: false,
      diffPresent: false,
      artifactPresent: false,
      output: '',
      error: 'Could not capture repository state',
      changedFiles: [],
      exitStatus: -1,
      checksPerformed: ['root-exists', 'git-check'],
    };
  }

  const cleanCheck = await isCleanForIntegration(input.approvedRoot);
  let worktreeManager: GitWorktreeManager | null = null;
  let workerRoot = input.approvedRoot;
  let isolatedWorktree = false;

  if (!cleanCheck.clean) {
    worktreeManager = new GitWorktreeManager();
    const managed = await worktreeManager.prepare({
      repositoryRoot: fingerprint.root,
      taskKey: `repo-action-${actionId.slice(0, 8)}`,
      assignmentKey: `isolated-${actionId.slice(0, 8)}`,
      baseHead: fingerprint.head,
    });
    workerRoot = managed.path;
    isolatedWorktree = true;
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
      checksPerformed: ['root-exists', 'git-check'],
      isolatedWorktree,
    };
  }

  const assignment = `## Objective\n${input.instruction}\n\n## Finish Condition\n${input.finishCondition}\n\n## Constraints\n- Work only within the approved root: ${input.approvedRoot}\n- Do not write to any path outside this root\n- Produce at least one concrete diff or artifact change\n- Verify your work with lint and test commands before completion`;

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
      cwd: workerRoot,
      timeoutMs: input.timeoutMs || 300000,
      inactivityTimeoutMs: 120000,
      onEvent(_event) {},
    });

    const hasDiff = result.output.includes('diff --git') || result.output.includes('--- a/') || result.output.includes('+++ b/');
    const hasArtifact = result.output.length > 50;
    const changedFiles = extractChangedFiles(result.output);

    const outOfScopeFiles = filesOutsideScope(
      changedFiles.map(f => resolve(input.approvedRoot, f)),
      [resolve(input.approvedRoot)]
    );

    if (outOfScopeFiles.length > 0) {
      return {
        actionId,
        verified: false,
        rootPreserved: false,
        diffPresent: hasDiff,
        artifactPresent: false,
        output: result.output.slice(0, 8000),
        error: `Worker wrote outside the approved root: ${outOfScopeFiles.join(', ')}`,
        changedFiles: [],
        exitStatus: result.exitStatus,
        checksPerformed: ['root-exists', 'git-check', 'scope-check'],
        isolatedWorktree,
      };
    }

    if (!hasDiff && !hasArtifact) {
      return {
        actionId,
        verified: false,
        rootPreserved: true,
        diffPresent: false,
        artifactPresent: false,
        output: result.output.slice(0, 8000),
        error: 'Worker completed with no diff or artifact. Activity-only completions are rejected.',
        changedFiles: [],
        exitStatus: result.exitStatus,
        checksPerformed: ['root-exists', 'git-check', 'scope-check', 'diff-artifact-check'],
        isolatedWorktree,
      };
    }

    const checksPerformed = ['root-exists', 'git-check', 'scope-check', 'diff-artifact-check'];
    const exitStatus = result.exitStatus;

    const canonicalRoot = resolve(input.approvedRoot);
    const relativeFiles = changedFiles
      .filter(f => {
        try { return resolve(f).startsWith(canonicalRoot); } catch { return false; }
      })
      .slice(0, 20);

    if (!cleanCheck.clean) {
      const diffDigest = hasDiff ? createHash('sha256').update(result.output.slice(0, 1000)).digest('hex') : undefined;

      return {
        actionId,
        verified: exitStatus === 0,
        rootPreserved: true,
        diffPresent: hasDiff,
        artifactPresent: hasArtifact,
        output: result.output.slice(0, 8000),
        error: cleanCheck.reason || `Cannot integrate: repository requires clean main checkout`,
        changedFiles: relativeFiles,
        diffDigest,
        diffSummary: hasDiff ? result.output.slice(0, 1000) : undefined,
        exitStatus,
        checksPerformed,
        isolatedWorktree: true,
        integrated: false,
        integrationStatus: 'unintegrated',
        handoffLocation: isolatedWorktree ? workerRoot : undefined,
      };
    }

    const currentSnapshot = await inspectRepository(input.approvedRoot).catch(() => null);
    if (!currentSnapshot || !fingerprintStillMatches(fingerprint, currentSnapshot)) {
      return {
        actionId,
        verified: false,
        rootPreserved: true,
        diffPresent: hasDiff,
        artifactPresent: hasArtifact,
        output: result.output.slice(0, 8000),
        error: 'Repository state changed during action execution. Result preserved as unintegrated artifact.',
        changedFiles: relativeFiles,
        exitStatus,
        checksPerformed: [...checksPerformed, 'state-check'],
        isolatedWorktree,
        integrated: false,
        integrationStatus: 'unintegrated',
        handoffLocation: isolatedWorktree ? workerRoot : undefined,
      };
    }

    const diffDigest = hasDiff ? createHash('sha256').update(result.output.slice(0, 1000)).digest('hex') : undefined;

    return {
      actionId,
      verified: exitStatus === 0 && hasDiff,
      rootPreserved: true,
      diffPresent: hasDiff,
      artifactPresent: hasArtifact,
      output: result.output.slice(0, 8000),
      error: result.error || undefined,
      changedFiles: relativeFiles,
      diffDigest,
      diffSummary: hasDiff ? result.output.slice(0, 1000) : undefined,
      exitStatus,
      checksPerformed: [...checksPerformed, 'state-check'],
      isolatedWorktree,
      integrated: exitStatus === 0 && hasDiff,
      integrationStatus: exitStatus === 0 && hasDiff ? 'integrated' : 'failed',
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
      checksPerformed: ['root-exists', 'git-check'],
      isolatedWorktree,
    };
  } finally {
    if (worktreeManager && isolatedWorktree && workerRoot !== input.approvedRoot) {
      try {
        await worktreeManager.remove(input.approvedRoot, { path: workerRoot, branchName: '', baseHead: fingerprint.head }, true);
      } catch { /* worktree cleanup is best-effort */ }
    }
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
