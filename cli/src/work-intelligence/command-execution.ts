import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ShellCommand, ShellExecutionRequest, ShellExecutionOutput, ShellExecutionResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const DENY_PATTERNS: RegExp[] = [
  /^rm\s+-rf\s+\//,
  /^rm\s+-rf\s+\/$/,
  /^rm\s+-rf\s+~/,
  /^rm\s+-rf\s+\$[A-Z_]+/,
  /^dd\s+if=/i,
  /^mkfs\./i,
  /^diskutil\s+erase/i,
  /^format\s+[a-z]:/i,
  /^shutdown|^reboot|^halt|^poweroff/,
  /^chmod\s+777\s+\//,
  /^:\s*\(\)\s*\{/,
  /^>\/dev\/sda/i,
  /^mkfs|^mke2fs|^mkswap/i,
  /^mkswap|^swapon|^losetup/i,
];

const NETWORK_DENY_PATTERNS: RegExp[] = [
  /^ssh\b/,
  /^scp\b/,
  /^rsync\b.*@/,
  /^nc\s+(?!-z\b)/,
  /^telnet\b/,
  /^ftp\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /(?:curl|wget)\s+.*?\|/i,
];

const INTERACTIVE_PATTERNS: RegExp[] = [
  /-i\b|--interactive/,
  /\bless\b|\bmore\b|\bvi\b|\bvim\b|\bnano\b|\bpico\b|\bemacs\b/,
  /\btop\b|\bhtop\b/,
  /\bsudo\b(?!\s+-n\b)/,
  /\bpasswd\b/,
];

interface ActiveExecution {
  execution: ShellExecutionResult;
  processes: Map<string, ChildProcess>;
  buffers: Map<string, { stdout: string; stderr: string }>;
}

const activeExecutions = new Map<string, ActiveExecution>();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, active] of activeExecutions) {
    if (new Date(active.execution.startTime).getTime() < cutoff) {
      active.processes.forEach(p => { try { p.kill(); } catch {} });
      activeExecutions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

export function validateShellCommand(cmd: ShellCommand): { ok: true } | { ok: false; reason: string } {
  if (!cmd.command || cmd.command.trim().length === 0) {
    return { ok: false, reason: 'Empty command' };
  }

  if (cmd.command.length > 2000) {
    return { ok: false, reason: 'Command too long (max 2000 characters)' };
  }

  const normalized = cmd.command.trim();

  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ok: false, reason: `Command matches deny pattern: ${pattern.source}` };
    }
  }

  for (const pattern of NETWORK_DENY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ok: false, reason: `Remote connection commands are not allowed: ${pattern.source}` };
    }
  }

  for (const pattern of INTERACTIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ok: false, reason: `Interactive commands are not allowed: ${pattern.source}` };
    }
  }

  if (cmd.workingDirectory && !existsSync(cmd.workingDirectory)) {
    return { ok: false, reason: `Working directory does not exist: ${cmd.workingDirectory}` };
  }

  return { ok: true };
}

export function validateShellExecutionRequest(
  req: unknown
): { ok: true; request: ShellExecutionRequest } | { ok: false; reason: string } {
  if (typeof req !== 'object' || req === null) {
    return { ok: false, reason: 'Request must be an object' };
  }

  const r = req as Record<string, unknown>;

  if (!Array.isArray(r.commands) || r.commands.length === 0) {
    return { ok: false, reason: 'At least one command is required' };
  }

  if (r.commands.length > 10) {
    return { ok: false, reason: 'Maximum 10 commands per execution' };
  }

  for (let i = 0; i < (r.commands as unknown[]).length; i++) {
    const cmd = (r.commands as unknown[])[i] as ShellCommand;
    const validation = validateShellCommand(cmd);
    if (!validation.ok) {
      return { ok: false, reason: `Command ${i + 1}: ${validation.reason}` };
    }
  }

  const executionId = randomUUID();
  const request: ShellExecutionRequest = {
    executionId,
    workSessionId: (r.workSessionId as string) || '',
    interactionId: (r.interactionId as string) || '',
    commands: (r.commands as ShellCommand[]).map((cmd, i) => ({
      commandId: cmd.commandId || `cmd-${i}`,
      command: cmd.command,
      workingDirectory: cmd.workingDirectory || (r.projectRoot as string) || process.cwd(),
      explanation: cmd.explanation || '',
      isDestructive: cmd.isDestructive ?? false,
    })),
    projectRoot: (r.projectRoot as string) || process.cwd(),
  };

  return { ok: true, request };
}

export function createExecution(result: ShellExecutionResult): ShellExecutionResult {
  activeExecutions.set(result.executionId, {
    execution: result,
    processes: new Map(),
    buffers: new Map(),
  });
  return result;
}

export function getExecutionStatus(executionId: string): ShellExecutionResult | null {
  const active = activeExecutions.get(executionId);
  return active ? aggregateResult(active) : null;
}

export async function runExecution(request: ShellExecutionRequest): Promise<ShellExecutionResult> {
  const outputs: ShellExecutionOutput[] = request.commands.map(cmd => ({
    commandId: cmd.commandId,
    stdout: '',
    stderr: '',
    exitCode: null,
    timedOut: false,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'pending' as const,
  }));

  const result: ShellExecutionResult = {
    executionId: request.executionId,
    status: 'running',
    commands: outputs,
    startTime: new Date().toISOString(),
    endTime: null,
  };

  const active: ActiveExecution = {
    execution: result,
    processes: new Map(),
    buffers: new Map(),
  };
  activeExecutions.set(request.executionId, active);

  for (let i = 0; i < request.commands.length; i++) {
    const cmd = request.commands[i];
    const output = outputs[i];

    try {
      await runSingleCommand(cmd, output, active, request.projectRoot);
    } catch (err) {
      output.status = 'error';
      output.stderr += `\nExecution error: ${(err as Error).message}`;
    }

    if (output.status === 'error' || (output.exitCode !== null && output.exitCode !== 0)) {
      break;
    }
  }

  result.endTime = new Date().toISOString();
  result.status = result.commands.every(c => c.status === 'completed' && c.exitCode === 0)
    ? 'completed'
    : result.commands.some(c => c.status === 'completed')
      ? 'partial'
      : 'failed';

  return result;
}

function runSingleCommand(
  cmd: ShellCommand,
  output: ShellExecutionOutput,
  active: ActiveExecution,
  projectRoot: string
): Promise<void> {
  return new Promise((resolve) => {
    output.status = 'running';
    active.execution.status = 'running';

    const cwd = cmd.workingDirectory || projectRoot;

    const SAFE_ENV_VARS = new Set([
      'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
      'TMPDIR', 'TMP', 'TEMP', 'PWD', 'OLDPWD', 'SHLVL', '_',
      'NVM_DIR', 'NVM_BIN', 'NVM_INC',
      'HOMEBREW_PREFIX', 'HOMEBREW_CELLAR', 'HOMEBREW_REPOSITORY',
      'COLORTERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
      'XPC_FLAGS', 'XPC_SERVICE_NAME',
      'SSH_AUTH_SOCK', 'SECURITYSESSIONID',
      '__CFBundleIdentifier', '__CF_USER_TEXT_ENCODING',
      'COMMAND_MODE', 'VSCODE_GIT_IPC_HANDLE', 'VSCODE_GIT_ASKPASS_NODE',
    ]);

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value && SAFE_ENV_VARS.has(key)) {
        env[key] = value;
      }
    }

    const PATH = env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    if (process.env.HOMEBREW_PREFIX) {
      env.PATH = `${process.env.HOMEBREW_PREFIX}/bin:${process.env.HOMEBREW_PREFIX}/sbin:${PATH}`;
    } else {
      env.PATH = `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:${PATH}`;
    }
    if (process.env.NVM_BIN) {
      env.PATH = `${process.env.NVM_BIN}:${env.PATH}`;
    }

    let child: ChildProcess;
    try {
      child = spawn('/bin/sh', ['-c', cmd.command], {
        cwd,
        env,
        timeout: DEFAULT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      output.status = 'error';
      output.stderr = `Failed to spawn process: ${(err as Error).message}`;
      output.completedAt = new Date().toISOString();
      resolve();
      return;
    }

    active.processes.set(cmd.commandId, child);
    active.buffers.set(cmd.commandId, { stdout: '', stderr: '' });

    const timeout = setTimeout(() => {
      output.timedOut = true;
      output.status = 'timeout';
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    }, DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      const buf = active.buffers.get(cmd.commandId);
      if (buf) buf.stdout += text;
      output.stdout += text;

      if (output.stdout.length > 50_000) {
        output.stdout = output.stdout.slice(-50_000);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      const buf = active.buffers.get(cmd.commandId);
      if (buf) buf.stderr += text;
      output.stderr += text;

      if (output.stderr.length > 50_000) {
        output.stderr = output.stderr.slice(-50_000);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      output.exitCode = code;
      output.completedAt = new Date().toISOString();
      output.status = output.timedOut ? 'timeout'
        : code === 0 ? 'completed'
        : 'completed';
      active.processes.delete(cmd.commandId);
      resolve();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      output.status = 'error';
      output.stderr += `\nProcess error: ${err.message}`;
      output.completedAt = new Date().toISOString();
      active.processes.delete(cmd.commandId);
      resolve();
    });
  });
}

export function cancelExecution(executionId: string): boolean {
  const active = activeExecutions.get(executionId);
  if (!active) return false;

  for (const [, proc] of active.processes) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    for (const [, proc] of active.processes) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  }, 2000);

  active.execution.status = 'cancelled';
  active.execution.endTime = new Date().toISOString();
  return true;
}

function aggregateResult(active: ActiveExecution): ShellExecutionResult {
  const outputs: ShellExecutionOutput[] = [];
  for (const cmd of active.execution.commands) {
    const buf = active.buffers.get(cmd.commandId);
    outputs.push({
      ...cmd,
      stdout: buf?.stdout ?? cmd.stdout,
      stderr: buf?.stderr ?? cmd.stderr,
    });
  }

  return {
    ...active.execution,
    commands: outputs,
  };
}
