import { execFile as nodeExecFile } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { packageCommands } from './verification-commands.js';

const execFileAsync = promisify(nodeExecFile);

type DependencyRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv },
) => Promise<unknown>;

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function runSandboxedDependencyInstall(
  executable: string,
  args: string[],
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv },
  repositoryRoot: string,
): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Dependency preparation sandbox is unavailable on this platform');
  const [allowedRoot, projectRoot] = await Promise.all([realpath(options.cwd), realpath(repositoryRoot)]);
  const home = await mkdtemp(join(tmpdir(), 'flyd-dependency-home-'));
  try {
    const allowedHome = await realpath(home);
    const gitMetadata = join(projectRoot, '.git');
    const profile = [
      '(version 1)',
      '(allow default)',
      '(deny file-read* (subpath "/Users"))',
      '(deny file-read* (subpath "/Volumes"))',
      '(deny file-write*)',
      `(allow file-read* (subpath ${JSON.stringify(projectRoot)}))`,
      `(allow file-write* (subpath ${JSON.stringify(allowedRoot)}))`,
      `(allow file-read* file-write* (subpath ${JSON.stringify(allowedHome)}))`,
      '(allow file-write* (subpath "/dev"))',
      '(allow file-write* (subpath "/private/var/run"))',
      `(deny file-write* (literal ${JSON.stringify(gitMetadata)}))`,
      `(deny file-write* (subpath ${JSON.stringify(gitMetadata)}))`,
    ].join('\n');
    await execFileAsync('/usr/bin/sandbox-exec', ['-p', profile, executable, ...args], {
      cwd: options.cwd,
      timeout: options.timeout,
      env: { ...options.env, HOME: allowedHome, TMPDIR: allowedHome, npm_config_cache: join(allowedHome, 'npm-cache') },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export async function prepareRepositoryDependencies(
  repositoryRoot: string,
  run?: DependencyRunner,
): Promise<string[]> {
  const projects = [
    { root: repositoryRoot, label: '.' },
    { root: join(repositoryRoot, 'cli'), label: 'cli' },
  ];
  const prepared: string[] = [];

  for (const project of projects) {
    if ((await packageCommands(project.root, 'package.json')).length === 0) continue;
    const lockfile = join(project.root, 'package-lock.json');
    if (!await exists(lockfile)) {
      throw new Error(`Refusing dependency preparation without trusted package-lock.json: ${project.root}`);
    }
    const options = {
      cwd: project.root,
      timeout: 5 * 60 * 1000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        npm_config_update_notifier: 'false',
      },
    };
    if (run) await run('npm', ['ci', '--no-audit', '--no-fund'], options);
    else await runSandboxedDependencyInstall('npm', ['ci', '--no-audit', '--no-fund'], options, repositoryRoot);
    prepared.push(`npm ci (${project.label})`);
  }

  return prepared;
}
