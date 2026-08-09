import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  CurrentWork,
  EvidenceItem,
  EvidenceSummary,
  ArtifactIdentity,
  DisplayBounds,
  WorkStage,
} from './types.js';

export interface EnvironmentCapture {
  application: { bundle_id: string; name: string };
  surface?: { kind: string; host?: string; title?: string };
  window: { title: string; ref: string };
  focused_element: {
    ref: string;
    role: string;
    description: string;
    value: string;
    placeholder: string;
    selected_text: string;
  };
  semantic_neighbourhood?: { parent_type?: string; context: Record<string, string> };
  selection: string;
  sufficiency: 'semantic' | 'partial';
  display_identity?: string;
  focused_bounds?: DisplayBounds;
  document_path?: string;
  open_documents?: string[];
}

export interface GroundingContext {
  environment: EnvironmentCapture;
  resolvedProjectRoot?: string;
  gitBranch?: string;
  gitHeadDigest?: string;
  gitStatusDigest?: string;
  gitRecentCommits?: string[];
  gitChangedFiles?: string[];
  screenshotBase64?: string;
}

export function constructCurrentWork(ctx: GroundingContext): CurrentWork {
  const env = ctx.environment;
  const now = new Date().toISOString();
  const projectEvidence = resolveProjectEvidence(env, ctx);
  const artifactIdentity = buildArtifactIdentity(env, ctx);
  const stageEvidence = inferStage(env);
  const objectiveEvidence = inferObjective(env, ctx);
  const constraintsEvidence = evidenceItem<string[]>([], 'foreground', 'low', 'No explicit constraints found', now, true);
  const nextActionEvidence = inferNextAction(env, now);
  const evidenceSummary = buildEvidenceSummary(env, ctx, now);

  const uncertaintyFields: { field: string; reason: string }[] = [];
  const confidenceFields: { field: string; confidence: 'high' | 'medium' | 'low' }[] = [];

  if (projectEvidence.isHypothesis) uncertaintyFields.push({ field: 'project', reason: 'Inferred from document/repository path' });
  if (objectiveEvidence.isHypothesis) uncertaintyFields.push({ field: 'objective', reason: 'No explicit goal state found' });
  if (constraintsEvidence.isHypothesis) uncertaintyFields.push({ field: 'constraints', reason: 'No explicit constraints found' });
  if (stageEvidence.isHypothesis) uncertaintyFields.push({ field: 'stage', reason: 'Inferred from foreground evidence pattern' });

  confidenceFields.push({ field: 'project', confidence: projectEvidence.confidence });
  confidenceFields.push({ field: 'artifact', confidence: artifactIdentity.contentDigest ? 'high' : 'low' });
  confidenceFields.push({ field: 'objective', confidence: objectiveEvidence.confidence });
  confidenceFields.push({ field: 'stage', confidence: stageEvidence.confidence });

  return {
    project: projectEvidence,
    objective: objectiveEvidence,
    artifact: artifactIdentity,
    stage: stageEvidence,
    constraints: constraintsEvidence,
    openLoops: [],
    nextAction: nextActionEvidence,
    evidenceSummary,
    uncertainty: uncertaintyFields,
    confidence: confidenceFields,
  };
}

function resolveProjectEvidence(
  env: EnvironmentCapture,
  ctx: GroundingContext
): EvidenceItem<string> {
  const now = new Date().toISOString();

  if (ctx.resolvedProjectRoot) {
    const projectName = extractProjectName(ctx.resolvedProjectRoot);
    return evidenceItem(projectName, 'foreground', 'high',
      `Document path resolves to Git repository root: ${ctx.resolvedProjectRoot}`, now, false);
  }

  if (ctx.gitBranch) {
    return evidenceItem(ctx.gitBranch.replace(/^feature\//, ''), 'repository', 'medium',
      `Branch name inferred from git: ${ctx.gitBranch}`, now, false);
  }

  const appName = env.application?.name;
  if (appName) {
    return evidenceItem(appName, 'foreground', 'low',
      `Foreground application: ${appName} (no repository evidence available)`, now, true);
  }

  return evidenceItem('unknown', 'foreground', 'low', 'No project evidence available', now, true);
}

function buildArtifactIdentity(
  env: EnvironmentCapture,
  ctx: GroundingContext
): ArtifactIdentity {
  const windowTitle = env.window?.title || env.application?.name || '';
  const kind = classifyArtifactKind(env);

  const identity: ArtifactIdentity = {
    kind,
    title: windowTitle || 'unknown',
    bundleId: env.application?.bundle_id,
    windowTitle,
    contentDigest: env.focused_element?.value
      ? `${kind}:${env.focused_element.value.slice(0, 80)}`
      : '',
  };

  if (ctx.resolvedProjectRoot && env.document_path) {
    identity.path = env.document_path;
  }

  if (env.display_identity) {
    identity.displayIdentity = env.display_identity;
  }

  if (env.focused_bounds && env.focused_element) {
    identity.selectedRegion = {
      bounds: env.focused_bounds,
      displayId: env.display_identity || 'unknown',
      contentSample: env.focused_element.selected_text || env.focused_element.value?.slice(0, 200) || '',
      elementRef: env.focused_element.ref,
    };
  }

  return identity;
}

function classifyArtifactKind(env: EnvironmentCapture): ArtifactIdentity['kind'] {
  const bundleId = (env.application?.bundle_id || '').toLowerCase();
  const role = env.focused_element?.role || '';
  const surfaceKind = env.surface?.kind;
  const windowTitle = (env.window?.title || '').toLowerCase();

  if (bundleId.includes('xcode') || bundleId.includes('vscode') || bundleId.includes('cursor') ||
      bundleId.includes('jetbrains') || bundleId.includes('terminal') || bundleId.includes('iterm')) {
    return 'code';
  }

  if (bundleId.includes('keynote') || bundleId.includes('powerpoint')) {
    return 'presentation';
  }

  if (bundleId.includes('pages') || bundleId.includes('word') || bundleId.includes('notes') ||
      bundleId.includes('notion') || bundleId.includes('obsidian') || bundleId.includes('bear')) {
    return 'document';
  }

  if (bundleId.includes('mail') || bundleId.includes('outlook') || bundleId.includes('slack') ||
      bundleId.includes('discord') || bundleId.includes('messages') || bundleId.includes('telegram')) {
    return 'message';
  }

  if (bundleId.includes('figma') || bundleId.includes('sketch') || bundleId.includes('photoshop') ||
      bundleId.includes('illustrator') || bundleId.includes('affinity')) {
    return 'design';
  }

  if (bundleId.includes('safari') || bundleId.includes('chrome') || bundleId.includes('firefox') ||
      bundleId.includes('arc')) {
    return 'research';
  }

  if (role.includes('TextArea') || role.includes('TextField')) {
    return 'document';
  }

  return 'unknown';
}

function inferStage(env: EnvironmentCapture): EvidenceItem<WorkStage> {
  const now = new Date().toISOString();
  const role = env.focused_element?.role || '';
  const selectedText = env.focused_element?.selected_text || '';

  if (role.includes('TextArea') && selectedText.length > 0) {
    return evidenceItem<WorkStage>('review', 'foreground', 'medium',
      'Text selected in editor suggests review', now, false);
  }

  if (role.includes('TextArea') || role.includes('TextField')) {
    return evidenceItem<WorkStage>('execution', 'foreground', 'medium',
      'Active text input suggests implementation/writing', now, false);
  }

  return evidenceItem<WorkStage>('exploration', 'foreground', 'low',
    'No editable foreground element; assumed exploration', now, true);
}

function inferObjective(
  env: EnvironmentCapture,
  ctx: GroundingContext
): EvidenceItem<string> {
  const now = new Date().toISOString();
  const intentEvidence = env.focused_element?.value?.slice(0, 200);

  if (intentEvidence && ctx.gitBranch) {
    return evidenceItem(`Work on ${ctx.gitBranch} branch`, 'foreground', 'medium',
      `Branch: ${ctx.gitBranch}; active content suggests implementation`, now, false);
  }

  return evidenceItem('unknown', 'foreground', 'low',
    'No explicit goal state found in foreground evidence', now, true);
}

function inferNextAction(
  env: EnvironmentCapture,
  now: string
): EvidenceItem<{ description: string; readiness: 'ready' | 'blocked' | 'uncertain' }> {
  const selectedText = env.focused_element?.selected_text;

  if (selectedText && selectedText.length > 0) {
    return evidenceItem(
      { description: 'Review the selected content', readiness: 'ready' },
      'foreground', 'high', 'User has active text selection', now, false
    );
  }

  if (env.focused_element?.role.includes('TextArea')) {
    return evidenceItem(
      { description: 'Continue working on the active editor content', readiness: 'ready' },
      'foreground', 'medium', 'Active editable text area', now, false
    );
  }

  return evidenceItem(
    { description: 'Inspect the current foreground artifact', readiness: 'ready' },
    'foreground', 'low', 'No editable element; inspection-only', now, false
  );
}

function buildEvidenceSummary(
  env: EnvironmentCapture,
  ctx: GroundingContext,
  now: string
): EvidenceSummary {
  const sources: string[] = ['foreground_element', 'window_title'];

  if (env.display_identity) sources.push('screenshot');
  if (ctx.resolvedProjectRoot) sources.push('repository');
  if (env.document_path) sources.push('document_path');
  if (ctx.gitRecentCommits?.length) sources.push('git_recent_commits');
  if (ctx.gitChangedFiles?.length) sources.push('git_diff');

  return {
    sources,
    snapshotTimestamp: now,
    foregroundApp: env.application?.name || 'unknown',
    repositoryRoot: ctx.resolvedProjectRoot,
    branch: ctx.gitBranch,
    headDigest: ctx.gitHeadDigest,
    statusDigest: ctx.gitStatusDigest,
    documentPath: env.document_path,
    activeWindowTitle: env.window?.title || env.application?.name || 'unknown',
    recentCommits: ctx.gitRecentCommits,
    changedFiles: ctx.gitChangedFiles,
    openDocuments: env.open_documents,
  };
}

export function resolveRepositoryFromPath(documentPath?: string): {
  root?: string;
  branch?: string;
  headDigest?: string;
  statusDigest?: string;
  recentCommits?: string[];
  changedFiles?: string[];
} {
  if (!documentPath) return {};

  try {
    const root = findGitRoot(documentPath);
    if (!root) return {};

    const branch = gitOutput(root, 'rev-parse --abbrev-ref HEAD') || undefined;
    const headDigest = gitOutput(root, 'rev-parse HEAD') || undefined;
    const status = gitStatusOutput(root);
    const statusDigest = createHash('sha256').update(status || 'clean').digest('hex');

    const recentCommitsRaw = gitOutput(root, 'log --oneline -5');
    const recentCommits = recentCommitsRaw
      ? recentCommitsRaw.split('\n').filter(Boolean)
      : undefined;

    const changedFilesRaw = status.length > 0
      ? gitOutput(root, 'diff --name-only HEAD')
      : undefined;
    const changedFiles = changedFilesRaw
      ? changedFilesRaw.split('\n').filter(Boolean).slice(0, 20)
      : undefined;

    return { root, branch, headDigest, statusDigest, recentCommits, changedFiles };
  } catch {
    return {};
  }
}

function gitStatusOutput(root: string): string {
  try {
    return execSync(`git -C "${root}" status --porcelain=v1 --untracked-files=all`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    }).trimEnd();
  } catch {
    return '';
  }
}

function findGitRoot(startPath: string): string | null {
  let current = startPath;
  for (let i = 0; i < 10; i++) {
    if (existsSync(`${current}/.git`)) return current;
    const parent = current.substring(0, current.lastIndexOf('/'));
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

function gitOutput(root: string, args: string): string {
  try {
    return execSync(`git -C "${root}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function extractProjectName(repoRoot: string): string {
  return repoRoot.split('/').pop() || repoRoot;
}

function evidenceItem<T>(
  value: T,
  source: EvidenceItem<T>['source'],
  confidence: EvidenceItem<T>['confidence'],
  provenance: string,
  sourceTimestamp: string,
  isHypothesis: boolean
): EvidenceItem<T> {
  return { value, source, confidence, provenance, sourceTimestamp, isHypothesis };
}
