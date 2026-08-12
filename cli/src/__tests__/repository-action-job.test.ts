import { describe, expect, it } from 'vitest';
import { RepositoryActionJobStore } from '../work-intelligence/repository-action-job.js';

describe('RepositoryActionJobStore', () => {
  it('returns immediately and exposes the terminal result through polling', async () => {
    const store = new RepositoryActionJobStore();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });

    const job = store.start('grant-1', async () => {
      await blocked;
      return { actionId: 'action-1', verified: true };
    });

    expect(job).toMatchObject({ jobId: 'grant-1', status: 'running' });
    expect(store.get('grant-1')).toMatchObject({ status: 'running' });
    release();
    await job.completion;
    expect(store.get('grant-1')).toMatchObject({
      status: 'completed',
      result: { actionId: 'action-1', verified: true },
    });
  });

  it('retains a bounded failed status when background execution throws', async () => {
    const store = new RepositoryActionJobStore();
    const job = store.start('grant-2', async () => { throw new Error('worker failed'); });
    await job.completion;

    expect(store.get('grant-2')).toMatchObject({ status: 'failed', error: 'worker failed' });
  });
});
