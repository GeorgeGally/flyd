import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, realpathSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute, relative } from 'node:path';

export interface FileReadRequest {
  path: string;
  projectRoot: string;
  resolved: string;
  startLine?: number;
  endLine?: number;
}

export interface FileReadResult {
  path: string;
  content: string;
  totalLines: number;
  startLine?: number;
  endLine?: number;
  truncated: boolean;
}

export interface FileGrepRequest {
  pattern: string;
  projectRoot: string;
  filePattern?: string;
  maxResults?: number;
}

export interface FileGrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface FileGrepResult {
  pattern: string;
  matches: FileGrepMatch[];
  totalMatches: number;
  truncated: boolean;
}

export interface FileWriteRequest {
  path: string;
  content: string;
  projectRoot: string;
  resolved: string;
  createDirectories?: boolean;
}

export interface FileWriteResult {
  path: string;
  created: boolean;
  bytesWritten: number;
  linesWritten: number;
}

const MAX_READ_LINES = 500;
const MAX_READ_BYTES = 50_000;
const MAX_WRITE_BYTES = 500_000;
const MAX_GREP_RESULTS = 200;
const GREP_TIMEOUT_MS = 15_000;

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.obj',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.ttf', '.otf', '.woff', '.woff2',
  '.db', '.sqlite', '.sqlite3',
]);

function resolveSafePath(requestedPath: string, projectRoot: string): string | null {
  const normalized = requestedPath.replace(/^~\//, '/');
  const absolute = isAbsolute(normalized) ? normalized : resolve(projectRoot, normalized);

  const relPath = relative(projectRoot, absolute);
  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    return null;
  }

  if (!existsSync(absolute)) {
    return null;
  }

  const realRoot = realpathSync(projectRoot);
  const realAbsolute = realpathSync(absolute);

  if (!realAbsolute.startsWith(realRoot + '/') && realAbsolute !== realRoot) {
    return null;
  }

  return realAbsolute;
}

export function validateFileRead(path: string, projectRoot: string): { ok: true; resolved: string } | { ok: false; reason: string } {
  if (!path || path.trim().length === 0) {
    return { ok: false, reason: 'Empty path' };
  }

  const resolved = resolveSafePath(path, projectRoot);
  if (!resolved) {
    return { ok: false, reason: `File not found or outside project root: ${path}` };
  }

  const ext = resolved.substring(resolved.lastIndexOf('.')).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Binary file type not readable: ${ext}` };
  }

  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    return { ok: false, reason: `Path is a directory, not a file: ${path}` };
  }

  return { ok: true, resolved };
}

export function readFile(request: FileReadRequest): FileReadResult {
  const { resolved, projectRoot, startLine, endLine } = request;
  const raw = readFileSync(resolved, 'utf-8');

  if (raw.length === 0) {
    return {
      path: relative(projectRoot, resolved),
      content: '',
      totalLines: 0,
      startLine: startLine ?? undefined,
      endLine: endLine ?? undefined,
      truncated: false,
    };
  }

  const lines = raw.split('\n');
  const totalLines = lines.length;

  const s = Math.max(1, startLine ?? 1);
  const e = Math.min(endLine ?? totalLines, totalLines);
  const slice = lines.slice(s - 1, e);
  const content = slice.join('\n');

  const truncated = content.length > MAX_READ_BYTES || slice.length > MAX_READ_LINES;
  const finalContent = truncated
    ? slice.slice(0, MAX_READ_LINES).join('\n').slice(0, MAX_READ_BYTES)
    : content;

  return {
    path: relative(projectRoot, resolved),
    content: finalContent,
    totalLines,
    startLine: s,
    endLine: e,
    truncated,
  };
}

export function validateFileGrep(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (!pattern || pattern.trim().length === 0) {
    return { ok: false, reason: 'Empty search pattern' };
  }

  if (pattern.length > 500) {
    return { ok: false, reason: 'Pattern too long (max 500 characters)' };
  }

  return { ok: true };
}

export function grepCodebase(request: FileGrepRequest): FileGrepResult {
  const { pattern, projectRoot, filePattern, maxResults = MAX_GREP_RESULTS } = request;

  try {
    const args = ['--no-heading', '-n', '--max-count=1'];
    if (filePattern) {
      args.push('--glob', filePattern);
    }
    args.push('-e', pattern, '--', projectRoot);

    const raw = execFileSync('rg', args, {
      encoding: 'utf-8',
      timeout: GREP_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
      cwd: projectRoot,
    });

    const lines = raw.trim().split('\n').filter(Boolean);
    const matches: FileGrepMatch[] = [];

    for (const line of lines.slice(0, maxResults)) {
      const sepIdx = line.indexOf(':');
      if (sepIdx === -1) continue;
      const file = line.substring(0, sepIdx);
      const rest = line.substring(sepIdx + 1);
      const lineSepIdx = rest.indexOf(':');
      if (lineSepIdx === -1) continue;
      const lineNum = parseInt(rest.substring(0, lineSepIdx), 10);
      const content = rest.substring(lineSepIdx + 1);

      const relFile = relative(projectRoot, resolve(projectRoot, file));
      if (relFile.startsWith('..')) continue;

      matches.push({ file: relFile, line: lineNum, content: content.slice(0, 200) });
    }

    return {
      pattern,
      matches,
      totalMatches: lines.length,
      truncated: lines.length > maxResults,
    };
  } catch (err: any) {
    if (err?.status === 1) {
      return { pattern, matches: [], totalMatches: 0, truncated: false };
    }
    throw err;
  }
}

export function validateFileWrite(
  path: string,
  content: string,
  projectRoot: string
): { ok: true; resolved: string } | { ok: false; reason: string } {
  if (!path || path.trim().length === 0) {
    return { ok: false, reason: 'Empty path' };
  }

  if (!content && content !== '') {
    return { ok: false, reason: 'Content is null/undefined' };
  }

  if (content.length > MAX_WRITE_BYTES) {
    return { ok: false, reason: `Content too large (max ${MAX_WRITE_BYTES} bytes)` };
  }

  const normalized = path.replace(/^~\//, '/');
  const absolute = isAbsolute(normalized) ? normalized : resolve(projectRoot, normalized);
  const relPath = relative(projectRoot, absolute);

  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    return { ok: false, reason: `Path outside project root: ${path}` };
  }

  const GIT_METAFILES = new Set(['.gitignore', '.gitmodules', '.gitattributes']);
  if (path.includes('/.git/') || path.startsWith('.git/') || GIT_METAFILES.has(relPath.split('/').pop() || '')) {
    return { ok: false, reason: 'Cannot write to .git files' };
  }

  const ext = absolute.substring(absolute.lastIndexOf('.')).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Binary file type not writable: ${ext}` };
  }

  const realRoot = realpathSync(projectRoot);
  const parentDir = absolute.substring(0, absolute.lastIndexOf('/') + 1) || absolute;

  let resolvedParent: string;
  if (existsSync(parentDir)) {
    resolvedParent = realpathSync(parentDir);
  } else {
    const parts = parentDir.replace(/\/$/, '').split('/');
    let longestExisting = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const prefix = parts.slice(0, i + 1).join('/');
      if (existsSync(prefix)) {
        try {
          const stat = lstatSync(prefix);
          if (stat.isSymbolicLink()) {
            return { ok: false, reason: `Path traverses via symlink: ${path}` };
          }
          longestExisting = realpathSync(prefix);
        } catch {
          return { ok: false, reason: `Cannot resolve path: ${path}` };
        }
        break;
      }
    }
    resolvedParent = longestExisting || parentDir;
  }

  if (!resolvedParent.startsWith(realRoot + '/') && resolvedParent !== realRoot) {
    return { ok: false, reason: `Path outside project root: ${path}` };
  }

  return { ok: true, resolved: absolute };
}

export function writeFile(request: FileWriteRequest): FileWriteResult {
  const { resolved, projectRoot, content, createDirectories } = request;

  const created = !existsSync(resolved);

  if (createDirectories !== false) {
    const dir = resolved.substring(0, resolved.lastIndexOf('/'));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  writeFileSync(resolved, content, 'utf-8');
  const lines = content.length === 0 ? 0 : content.split('\n').length;

  return {
    path: relative(projectRoot, resolved),
    created,
    bytesWritten: Buffer.byteLength(content, 'utf-8'),
    linesWritten: lines,
  };
}
