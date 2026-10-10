import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VITEST = '1';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
  }
  return next(specifier, context);
} });
const { ComposerPredictions, DEFAULT_PREDICTION_MODEL, eligibleDraft, boundedSuffix, predictionPrompt, completePrediction } = await import('../src/conversation-view/composer-predictions.ts');
const { installComposerPredictions } = await import('../src/conversation-view/composer-predictions-client.ts');
const input = (draft = 'implement it') => ({ session: 'one', draft, messages: [{ id: 'a', role: 'assistant', text: 'We can change the composer.' }] });
function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'flyd-predict-'));
  const engine = new ComposerPredictions({ root, now: () => 10000, ...options });
  return { root, engine, close: () => { engine.close(); rmSync(root, { recursive: true, force: true }); } };
}
test('default is non-Meta and serialized client is executable JavaScript', () => {
  assert.equal(DEFAULT_PREDICTION_MODEL, 'openrouter:inception/mercury-2.5');
  assert.doesNotThrow(() => new Function('return (' + installComposerPredictions.toString() + ')'));
});
test('repeated submitted phrases match without a model, survive restart, and are private', async () => {
  let calls = 0; const f = fixture({ provider: async () => { calls++; return { text: ' nonsense' }; } });
  try {
    f.engine.remember('implement it and check the tests'); f.engine.remember('implement it and check the tests');
    const p = await f.engine.predict(input()); assert.equal(p.source, 'local'); assert.equal(p.suffix, ' and check the tests'); assert.equal(calls, 0);
    assert.equal(statSync(join(f.root, 'phrases.json')).mode & 0o777, 0o600);
    const restored = new ComposerPredictions({ root: f.root, enabled: true }); assert.equal((await restored.predict(input())).source, 'local'); restored.close();
  } finally { f.close(); }
});
test('secrets, commands, empty and multiline drafts never call a provider or enter phrase cache', async () => {
  let calls = 0; const f = fixture({ provider: async () => { calls++; return { text: ' nope' }; } });
  try {
    for (const draft of ['ok', '/review', 'password=abc', 'hello\nworld', 'token Bearer abcdef']) { assert.equal(await f.engine.predict(input(draft)), null); f.engine.remember(draft); }
    assert.equal(calls, 0); assert.equal(f.engine.status().phrases, 0);
  } finally { f.close(); }
});
test('prediction prompt is bounded current-thread text with no system facts or relays', () => {
  const p = JSON.parse(predictionPrompt({ ...input(), messages: [
    { id: 'secret', role: 'user', text: 'password=abc' }, { id: 'aside', role: 'assistant', text: 'unrelated', aside: true },
    ...Array.from({ length: 20 }, (_, i) => ({ id: String(i), role: 'user', text: String(i) + 'x'.repeat(2000) }))
  ] }));
  assert.equal(p.conversation.length, 6); assert.ok(p.conversation.every(m => m.text.length <= 400)); assert.equal(p.unfinished_user_message, 'implement it');
  assert.ok(!JSON.stringify(p).includes('password'));
});
test('bounded suggestions keep leading spaces, reject protocols and avoid split words', () => {
  assert.equal(boundedSuffix(' and check the tests'), ' and check the tests');
  assert.equal(boundedSuffix('<script>'), ''); assert.equal(boundedSuffix(' https://x.test'), '');
  assert.ok(boundedSuffix(' ' + 'word '.repeat(20)).trim().split(/\s+/).length <= 12);
});
test('provider deadline cancels even a promise that ignores its abort signal', async () => {
  let signal; const f = fixture({ timeoutMs: 5, provider: async (_prompt, s) => { signal = s; return new Promise(() => {}); } });
  try { assert.equal(await f.engine.predict(input()), null); assert.equal(signal.aborted, true); assert.equal(f.engine.status().models[f.engine.model].timeouts, 1); }
  finally { f.close(); }
});
test('client cancellation is forwarded and cannot create a late offer', async () => {
  let finish; const f = fixture({ provider: () => new Promise(r => { finish = r; }) });
  try { const controller = new AbortController(); const pending = f.engine.predict(input(), controller.signal); controller.abort(); assert.equal(await pending, null); finish({ text: ' late' }); assert.equal(f.engine.status().models[f.engine.model].offered, 0); }
  finally { f.close(); }
});
test('review feedback is deduplicated, scoped, and metrics contain no wording', async () => {
  const f = fixture({ provider: async () => ({ text: ' and check the tests', inputTokens: 12, outputTokens: 5 }) });
  try {
    const p = await f.engine.predict(input()); f.engine.feedback('other', p.id, 'shown'); f.engine.feedback('one', p.id, 'accepted');
    f.engine.feedback('one', p.id, 'shown'); f.engine.feedback('one', p.id, 'accepted', 10); f.engine.feedback('one', p.id, 'accepted', 10); f.engine.feedback('one', p.id, 'edited');
    const m = f.engine.status().models[f.engine.model]; assert.equal(m.accepted, 1); assert.equal(m.acceptedCharacters, 10); assert.equal(m.edited, 1); assert.equal(m.billedCost, null);
    assert.ok(!readFileSync(join(f.root, 'metrics.json'), 'utf8').includes('implement')); assert.ok(!readFileSync(join(f.root, 'metrics.json'), 'utf8').includes('check the tests'));
  } finally { f.close(); }
});
test('errors cool down instead of triggering a paid fallback; disabled means no collection', async () => {
  let now = 10000, calls = 0; const f = fixture({ now: () => now, provider: async () => { calls++; throw Error('no'); } });
  try { assert.equal(await f.engine.predict(input()), null); now += 1000; assert.equal(await f.engine.predict(input()), null); assert.equal(calls, 1); }
  finally { f.close(); }
  const d = fixture({ enabled: false, provider: async () => { throw Error('must not call'); } });
  try { d.engine.remember('implement it'); assert.equal(await d.engine.predict(input()), null); assert.equal(d.engine.status().phrases, 0); } finally { d.close(); }
});
test('malformed saved metrics cannot break the composer', async () => {
  const f = fixture(); try { writeFileSync(join(f.root, 'metrics.json'), JSON.stringify({ broken: { latencyMs: 'oops', requests: 'no' } })); const engine = new ComposerPredictions({ root: f.root }); assert.doesNotThrow(() => engine.status()); engine.close(); } finally { f.close(); }
});
test('actual transport sends bounded no-reasoning context, propagates abort and parses exact suffix', async () => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.OPENROUTER_API_KEY;
  let request; process.env.OPENROUTER_API_KEY = 'test';
  globalThis.fetch = async (url, options) => { request = { url, ...options }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"suffix":" and check the tests"}' } }], usage: { prompt_tokens: 10, completion_tokens: 6, cost: 0.000001 } })); };
  try {
    const controller = new AbortController(); const result = await completePrediction(predictionPrompt(input()), DEFAULT_PREDICTION_MODEL, controller.signal);
    const body = JSON.parse(request.body); assert.equal(body.model, 'inception/mercury-2.5'); assert.equal(body.max_tokens, 96); assert.equal(body.reasoning.effort, 'none'); assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.provider.data_collection, 'deny'); assert.equal(request.signal, controller.signal); assert.equal(result.text, ' and check the tests'); assert.equal(result.cost, .000001);
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey; }
});
