import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coordinatePreparation } from '../conversational-initiative.js';
import { PreparationStore } from '../preparation-store.js';
import { runLocalPreparation } from '../../command/local-preparation.js';
import type { ConversationTurnSource } from '../conversation-turn.js';
vi.mock('../../lib/config.js', () => ({ chatModelChain: () => ['test:model'], resolveModelConnection: () => ({ model: 'test:model', apiKey: 'fixture', providerIdentity: 'test/provider' }) }));
let dir: string, store: PreparationStore;
const source = (turnId: string, text: string): ConversationTurnSource => ({ turnId, sessionId: 'market', text, revision: 1, consentRef: 'conversation:market', surface: 'view', final: true, retention: 'local_default' });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'flyd-initiative-')); store = new PreparationStore({ path: join(dir, 'state.sqlite') }); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function grant() {
  const text = 'Keep preparing local sponsor follow-up drafts for Christmas.';
  coordinatePreparation({ source: source('grant', text), route: 'act', reading: { kind: 'grant', goal: 'Christmas sponsor follow-ups', sourceSpan: text } }, { store });
  return store.listRemits('market')[0];
}
describe('conversation to checked draft', () => {
  it('starts no work from a quoted concern or permission, including a directly injected reading', () => {
    const run = vi.fn(), span = 'Keep preparing sponsor drafts';
    coordinatePreparation({ source: source('quoted-grant', `He wrote: "${span}"`), route: 'act', reading: { kind: 'grant', goal: 'Sponsors', sourceSpan: span } }, { store, run });
    expect(store.listRemits('market')).toEqual([]);
    const remit = grant(), concern = 'The sponsor still has not replied.';
    coordinatePreparation({ source: source('quoted-concern', `> ${concern}`), route: 'answer', reading: { kind: 'prepare', remitId: remit.id, sourceSpan: concern } }, { store, run });
    expect(run).not.toHaveBeenCalled();
    expect(store.list('market')).toEqual([]);
  });
  it('keeps an ungrounded concern conversational and never creates its own authority', () => {
    const text = 'The sponsor still has not replied.';
    const run = vi.fn();
    coordinatePreparation({ source: source('concern', text), route: 'answer', reading: { kind: 'prepare', remitId: 'invented', sourceSpan: text } }, { store, run });
    coordinatePreparation({ source: source('concern', text), route: 'answer', reading: { kind: 'grant', goal: 'Sponsors', sourceSpan: text } }, { store, run });
    expect(run).not.toHaveBeenCalled(); expect(store.listRemits('market')).toEqual([]);
  });
  it('grants once, prepares beside an answer, checks independently, and reuses the result on replay', async () => {
    const remit = grant(), text = 'The sponsor still has not replied.';
    const work: Promise<boolean>[] = [], onAccepted = vi.fn();
    const run: typeof runLocalPreparation = (input, deps) => {
      const replies = ['Hello, following up on the Christmas sponsorship conversation. Are you interested in discussing it?', 'MET 1: `Hello, following up` is a usable sponsor follow-up.\nMET 2: `Christmas sponsorship` comes from the supplied grant; no external action claimed.'];
      const running = runLocalPreparation(input, { ...deps, complete: async () => replies.shift()! }); work.push(running); return running;
    };
    const input = { source: source('concern', text), route: 'answer', reading: { kind: 'prepare' as const, remitId: remit.id, sourceSpan: text }, onAccepted };
    expect(coordinatePreparation(input, { store, run })).toContain('accepted');
    await Promise.all(work);
    expect(store.list('market')[0].status).toBe('prepared');
    expect(store.list('market')[0].content).toContain('Hello, following up');
    coordinatePreparation(input, { store, run });
    expect(work).toHaveLength(1);
    expect(store.list('market')).toHaveLength(1);
  });
  it('pauses venting without revoking unrelated work and revokes the named scope on stop', () => {
    const remit = grant();
    const run = vi.fn();
    coordinatePreparation({ source: source('vent', 'I am just venting.'), route: 'answer', reading: { kind: 'pause', remitId: remit.id, sourceSpan: 'just venting' } }, { store, run });
    expect(store.listRemits('market')).toHaveLength(1); expect(run).not.toHaveBeenCalled();
    coordinatePreparation({ source: source('stop', 'Leave the sponsor alone.'), route: 'act', reading: { kind: 'cancel', remitId: remit.id, sourceSpan: 'Leave the sponsor alone.' } }, { store, run });
    expect(store.listRemits('market')).toHaveLength(0);
  });
});

it('passes intervening user evidence with its exact source identity', async () => {
  const remit=grant(), text='The sponsor still has not replied.';
  const run=vi.fn<typeof runLocalPreparation>(async () => false);
  const inputSource={...source('concern-with-facts',text),context:[{ref:'ask:sponsor-details',text:'The sponsor is Acme. Their contact is Alex.'}]};
  coordinatePreparation({source:inputSource,route:'answer',reading:{kind:'prepare',remitId:remit.id,sourceSpan:text}},{store,run});
  const input=run.mock.calls[0]?.[0];
  expect(input?.context).toContainEqual({ref:'ask:sponsor-details',text:'The sponsor is Acme. Their contact is Alex.'});
});
