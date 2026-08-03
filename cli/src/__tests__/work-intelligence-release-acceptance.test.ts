import { describe, it, expect } from 'vitest';
import { WORK_CONTRACT_VERSION } from '../work-intelligence/types.js';

describe('work-intelligence release acceptance', () => {
  it('contract version is stable and non-zero', () => {
    expect(WORK_CONTRACT_VERSION).toBe(1);
    expect(WORK_CONTRACT_VERSION).toBeGreaterThan(0);
  });

  it('contract types are importable with no platform dependencies', async () => {
    const types = await import('../work-intelligence/types.js');
    const journal = await import('../work-intelligence/outcome-journal.js');
    expect(types.WORK_CONTRACT_VERSION).toBe(1);
    expect(journal.recordJournalEntry).toBeDefined();
  });
});
