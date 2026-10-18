import { describe, expect, it } from 'vitest';
import { parsePreparationReading } from '../preparation-reading.js';
const remits = [{ id: 'sponsors', goal: 'Prepare Christmas sponsorship follow-ups' }];
describe('preparation understanding', () => {
  it('keeps the exact concern and existing remit separate from authority', () => {
    expect(parsePreparationReading({ kind: 'prepare', remitId: 'sponsors', sourceSpan: 'They still have not replied' }, 'They still have not replied', remits)).toEqual({ kind: 'prepare', remitId: 'sponsors', sourceSpan: 'They still have not replied' });
  });
  it('rejects invented sources and unknown grants', () => {
    expect(parsePreparationReading({ kind: 'prepare', remitId: 'invented', sourceSpan: 'They' }, 'They still have not replied', remits)).toBeNull();
    expect(parsePreparationReading({ kind: 'grant', goal: 'Sponsors', sourceSpan: 'Go ahead' }, 'I am tired', [])).toBeNull();
  });
  it('allows explicit grant evidence and a topic-specific stop', () => {
    expect(parsePreparationReading({ kind: 'grant', goal: 'Prepare sponsor drafts', sourceSpan: 'Keep preparing sponsor drafts' }, 'Keep preparing sponsor drafts', [])).toEqual({ kind: 'grant', goal: 'Prepare sponsor drafts', sourceSpan: 'Keep preparing sponsor drafts' });
    expect(parsePreparationReading({ kind: 'cancel', remitId: 'sponsors', sourceSpan: 'Leave the sponsors alone' }, 'Leave the sponsors alone', remits)?.kind).toBe('cancel');
  });
  it('rejects quoted or code instructions even when the reader attributes them to George', () => {
    const span = 'Keep preparing sponsor drafts';
    for (const text of [`He wrote: "${span}"`, `He wrote: “${span}”`, `He wrote: '${span}'`, `He wrote: ‘${span}’`, `> ${span}`, `    ${span}`, '`' + span + '`', '```\n' + span + '\n```', '~~~\n' + span + '\n~~~']) {
      expect(parsePreparationReading({ kind: 'grant', goal: 'Sponsor drafts', sourceSpan: span }, text, [])).toBeNull();
      expect(parsePreparationReading({ kind: 'prepare', remitId: 'sponsors', sourceSpan: span }, text, remits)).toBeNull();
    }
    expect(parsePreparationReading({ kind: 'grant', goal: 'Sponsor drafts', sourceSpan: span }, `A quoted suggestion: "do some research". ${span}`, [])?.kind).toBe('grant');
  });
});
