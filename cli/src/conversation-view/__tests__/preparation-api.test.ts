import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ConversationViewServer } from '../server.js';
import { PreparationStore } from '../../runtime/preparation-store.js';
import type { ConversationSource } from '../types.js';

it('reviews and stops preparation with authenticated same-origin controls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flyd-preparation-api-'));
  process.env.FLYD_INITIATIVE_DB = join(dir, 'state.sqlite');
  const store = new PreparationStore();
  const source = { turnId: 't1', sessionId: 'view:market', text: 'Keep preparing sponsor drafts', revision: 1, consentRef: 'conversation:view:market' };
  const remit = store.registerRemit(source, { goal: 'Christmas sponsors', providerIdentity: 'test/provider' });
  const server = new ConversationViewServer({ listSessions: async () => [{ id: 'market' }], assistantLabel: 'Flyd', canSend: true } as unknown as ConversationSource,
    undefined, undefined, undefined, { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} } as never);
  try {
    const port = await server.listen(0), base = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(base + '/api/token')).json()).token;
    expect((await fetch(base + '/api/preparation?session=market')).status).toBe(403);
    const page = await (await fetch(base + '/preparation?session=market')).text();
    expect(page).toContain('Local preparation');
    expect(page).toContain('Stop preparing');
    const headers = { 'x-flyd-view-token': token, 'content-type': 'application/json' };
    const state = await (await fetch(base + '/api/preparation?session=market', { headers })).json();
    expect(state.remits[0].goal).toBe('Christmas sponsors');
    expect((await fetch(base + '/api/preparation?session=market', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: JSON.stringify({ action: 'cancel', id: remit.id }) })).status).toBe(403);
    expect((await fetch(base + '/api/preparation?session=market', { method: 'POST', headers, body: JSON.stringify({ action: 'cancel', id: remit.id }) })).status).toBe(200);
    expect(store.listRemits(source.sessionId)).toEqual([]);
  } finally { await server.close(); delete process.env.FLYD_INITIATIVE_DB; rmSync(dir, { recursive: true, force: true }); }
});
