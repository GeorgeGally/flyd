import { existsSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadFlydWorkerConfig } from '../runtime/flyd-worker-config.js';
import { createFlydWorkerAdapter, verifyRepositoryActionDependencyBoundary } from '../runtime/flyd-worker-adapter.js';
import { inspectRepository, captureActionGrantFingerprint, fingerprintStillMatches } from '../runtime/repository-inspector.js';
import { filesOutsideScope, verifyWorkerResult } from '../runtime/result-verifier.js';
import { verificationCommandsForRepository } from '../runtime/verification-commands.js';
import { prepareRepositoryDependencies } from '../runtime/repository-dependencies.js';
import { GitWorktreeManager } from '../runtime/worktree-manager.js';
import { fileURLToPath } from 'node:url';
import type { TargetFingerprint } from './types.js';

export interface RepositoryActionInput {
  approvedRoot: string;
  instruction: string;
  finishCondition: string;
  workSessionRevision: number;
  actionGrantId: string;
  expectedFingerprint: TargetFingerprint;
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
  beforeStateDigest?: string;
  afterStateDigest?: string;
  approvedSourceFingerprintDigest?: string;
  postRunSourceFingerprintDigest?: string;
  verificationResults?: { executable: string; exitStatus: number; outputDigest: string }[];
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
  const validationError = validateRepositoryActionInput(input);
  if (validationError) {
    return failedRepositoryAction(actionId, validationError, []);
  }

  const boundaryCheck = verifyModuleDependencyBoundary();
  if (!boundaryCheck.ok) {
    return failedRepositoryAction(
      actionId,
      `Dependency boundary violation: ${boundaryCheck.violations.join('; ')}`,
      ['dependency-boundary'],
    );
  }

  const fingerprint = await captureActionGrantFingerprint(input.approvedRoot).catch(() => null);
  if (!fingerprint) {
    return failedRepositoryAction(actionId, 'Could not capture repository state', ['root-exists', 'git-check']);
  }
  if (fingerprint.dirty) {
    return failedRepositoryAction(
      actionId,
      'Repository has uncommitted changes; this action requires a clean approved source fingerprint',
      ['root-exists', 'git-check', 'clean-source-check'],
    );
  }
  const approvedSourceFingerprintDigest = createHash('sha256').update(JSON.stringify({
    root: resolve(fingerprint.root), branch: fingerprint.branch, head: fingerprint.head,
    dirty: fingerprint.dirty, statusDigest: fingerprint.statusDigest,
  })).digest('hex');

  const expected = input.expectedFingerprint;
  if (
    resolve(expected.repositoryRoot ?? '') !== resolve(fingerprint.root)
    || expected.branch !== fingerprint.branch
    || expected.headDigest !== fingerprint.head
    || expected.statusDigest !== fingerprint.statusDigest
  ) {
    return failedRepositoryAction(
      actionId,
      'Repository state no longer matches the approved action proposal',
      ['root-exists', 'git-check', 'grant-fingerprint-check'],
    );
  }

  const worktreeManager = new GitWorktreeManager();
  let managed: Awaited<ReturnType<GitWorktreeManager['prepare']>> | null = null;
  let preserveWorktree = false;
  let workerRoot = '';
  try {
    await worktreeManager.prune();
    managed = await worktreeManager.prepare({
      repositoryRoot: fingerprint.root,
      taskKey: `repo-action-${actionId.slice(0, 8)}`,
      assignmentKey: `isolated-${actionId.slice(0, 8)}`,
      baseHead: fingerprint.head,
    });
    workerRoot = managed.path;
    const dependencyPreparation = await prepareRepositoryDependencies(workerRoot);
    const config = loadFlydWorkerConfig();
    const sessionRoot = join(tmpdir(), 'flyd-repo-action', actionId);
    const adapter = createFlydWorkerAdapter({
      config,
      sessionRoot,
      repositoryRoots: [workerRoot],
      fileOperations: ['read', 'write'],
      commandClasses: ['inspect', 'test', 'lint', 'git_status', 'git_diff'],
    });
    const health = await adapter.detect();
    if (!health.healthy) {
      return failedRepositoryAction(
        actionId,
        `Worker not healthy: ${health.error || 'unknown'}`,
        ['root-exists', 'git-check', 'grant-fingerprint-check', 'isolated-worktree', ...dependencyPreparation],
        true,
      );
    }

    const assignment = `## Objective\n${input.instruction}\n\n## Finish Condition\n${input.finishCondition}\n\n## Constraints\n- Work only within the managed worktree: ${workerRoot}\n- Do not write to any path outside this worktree\n- Produce at least one concrete repository change\n- Verify your work before completion`;
    const args = adapter.buildArgs({
      assignment,
      projectRoot: workerRoot,
      taskKey: `repo-action-${actionId.slice(0, 8)}`,
      readOnly: false,
    });
    const result = await adapter.run({
      executable: process.execPath,
      args,
      cwd: workerRoot,
      timeoutMs: input.timeoutMs || 300000,
      inactivityTimeoutMs: 120000,
      onEvent(_event) {},
    });
    const commands = await verificationCommandsForRepository(workerRoot);
    const verification = await verifyWorkerResult({
      worktreePath: workerRoot,
      baseHead: fingerprint.head,
      commands,
      commandTimeoutMs: input.timeoutMs,
      requireChanges: true,
    });
    const changedFiles = verification.changedFiles.slice(0, 100);
    const canonicalWorkerRoot = resolve(workerRoot);
    const outOfScopeFiles = filesOutsideScope(
      changedFiles.map(file => resolve(workerRoot, file)),
      [canonicalWorkerRoot],
    );
    const hasDiff = changedFiles.length > 0;
    preserveWorktree = hasDiff;
    const beforeStateDigest = createHash('sha256').update(`${fingerprint.head}\n`).digest('hex');
    const afterStateDigest = createHash('sha256').update(`${fingerprint.head}\n${verification.patch}`).digest('hex');
    if (hasDiff && managed) await worktreeManager.preserveHandoff(managed);
    const currentSnapshot = await inspectRepository(input.approvedRoot).catch(() => null);
    const postRunSourceFingerprintDigest = currentSnapshot
      ? createHash('sha256').update(JSON.stringify({
          root: resolve(currentSnapshot.root), branch: currentSnapshot.branch, head: currentSnapshot.head,
          dirty: currentSnapshot.dirty, statusDigest: currentSnapshot.statusDigest,
        })).digest('hex')
      : undefined;
    if (!currentSnapshot || !fingerprintStillMatches(fingerprint, currentSnapshot)) {
      return {
        actionId,
        verified: false,
        rootPreserved: true,
        diffPresent: hasDiff,
        artifactPresent: hasDiff,
        output: result.output.slice(0, 8000),
        error: 'Repository state changed during action execution. Result preserved as unintegrated artifact.',
        changedFiles,
        diffDigest: verification.patchDigest,
        diffSummary: verification.patch.slice(0, 1000),
        exitStatus: result.exitStatus,
        checksPerformed: ['root-exists', 'git-check', 'grant-fingerprint-check', 'isolated-worktree', ...dependencyPreparation, ...commands, 'source-state-check'],
        isolatedWorktree: true,
        integrated: false,
        integrationStatus: 'unintegrated',
        handoffLocation: hasDiff ? workerRoot : undefined,
        approvedSourceFingerprintDigest,
        postRunSourceFingerprintDigest,
        verificationResults: verification.commands.map(command => ({
          executable: command.executable,
          exitStatus: command.exitStatus,
          outputDigest: command.outputDigest,
        })),
        beforeStateDigest,
        afterStateDigest,
      };
    }
    const verified = result.exitStatus === 0 && verification.passed && outOfScopeFiles.length === 0;
    return {
      actionId,
      verified,
      rootPreserved: true,
      diffPresent: hasDiff,
      artifactPresent: hasDiff,
      output: result.output.slice(0, 8000),
      error: outOfScopeFiles.length > 0
        ? `Worker changed files outside the managed worktree: ${outOfScopeFiles.join(', ')}`
        : result.error || (verified ? undefined : 'Repository changes did not pass independent verification'),
      changedFiles,
      diffDigest: verification.patchDigest,
      diffSummary: hasDiff ? verification.patch.slice(0, 1000) : undefined,
      exitStatus: result.exitStatus,
      checksPerformed: ['root-exists', 'git-check', 'grant-fingerprint-check', 'isolated-worktree', ...dependencyPreparation, ...commands, 'source-state-check'],
      isolatedWorktree: true,
      integrated: false,
      integrationStatus: 'unintegrated',
      handoffLocation: hasDiff ? workerRoot : undefined,
      beforeStateDigest,
      afterStateDigest,
      approvedSourceFingerprintDigest,
      postRunSourceFingerprintDigest,
      verificationResults: verification.commands.map(command => ({
        executable: command.executable,
        exitStatus: command.exitStatus,
        outputDigest: command.outputDigest,
      })),
    };
  } catch (err) {
    return failedRepositoryAction(
      actionId,
      `Worker execution failed: ${(err as Error).message}`,
      ['root-exists', 'git-check', 'grant-fingerprint-check', 'isolated-worktree'],
      true,
    );
  } finally {
    if (managed && !preserveWorktree) {
      try {
        await worktreeManager.remove(input.approvedRoot, managed, true);
      } catch { /* worktree cleanup is best-effort */ }
    }
  }
}

function failedRepositoryAction(
  actionId: string,
  error: string,
  checksPerformed: string[],
  rootPreserved = true,
): RepositoryActionResult {
  return {
    actionId,
    verified: false,
    rootPreserved,
    diffPresent: false,
    artifactPresent: false,
    output: '',
    error,
    changedFiles: [],
    exitStatus: -1,
    checksPerformed,
    isolatedWorktree: checksPerformed.includes('isolated-worktree'),
    integrated: false,
    integrationStatus: 'unintegrated',
  };
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
  if (!input.finishCondition || typeof input.finishCondition !== 'string' || !input.finishCondition.trim()) {
    return 'Missing finish condition';
  }
  if (!Number.isInteger(input.workSessionRevision) || input.workSessionRevision <= 0) {
    return 'Invalid Work Session revision';
  }
  if (!input.actionGrantId || typeof input.actionGrantId !== 'string') {
    return 'Missing action grant ID';
  }
  if (!input.expectedFingerprint || typeof input.expectedFingerprint !== 'object') {
    return 'Missing approved repository fingerprint';
  }
  if (!existsSync(input.approvedRoot)) {
    return `Root does not exist: ${input.approvedRoot}`;
  }
  if (!existsSync(join(input.approvedRoot, '.git'))) {
    return `Not a git repository: ${input.approvedRoot}`;
  }
  return null;
}
