import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRepositoryDependencies } from '../repository-dependencies.js';

describe('prepareRepositoryDependencies', () => {
  it('installs locked dev dependencies in a fresh Flyd clone before worker execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flyd-dependency-prep-'));
    await mkdir(join(root, 'cli'), { recursive: true });
    await writeFile(join(root, 'cli', 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    await writeFile(join(root, 'cli', 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
    const run = vi.fn(async () => undefined);

    const prepared = await prepareRepositoryDependencies(root, run);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('npm', [
      'ci', '--no-audit', '--no-fund',
    ], expect.objectContaining({ cwd: join(root, 'cli') }));
    expect(prepared).toEqual(['npm ci (cli)']);
  });

  it('fails closed when npm verification is configured without a lockfile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flyd-dependency-prep-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));

    await expect(prepareRepositoryDependencies(root, vi.fn())).rejects.toThrow('package-lock.json');
  });
});
