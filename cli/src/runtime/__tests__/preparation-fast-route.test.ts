import { expect, it, vi } from 'vitest';
const evaluation = vi.hoisted(() => ({ answers: {} as Record<string, unknown> }));
vi.mock('../../cognition/system-one/jev.js', () => ({
  JEV_PINNED_MODEL: 'jev-1.13.0', projectJevState: (state: unknown) => state,
  evaluatePredicates: async () => ({ ok: true, answers: evaluation.answers, model: 'synthetic', latencyMs: 1 }),
}));
import { routeWithJev } from '../turn-plan.js';
function base() {
  evaluation.answers = {
    chat_turn_route: { choice: 'answer', confidence: 1 }, chat_turn_needs_code: { probability: 0 },
    chat_turn_domain: { choice: 'general', confidence: 1 }, chat_turn_command_kind: { choice: 'general', confidence: 1 },
    chat_preparation_grant: { probability: 0.02 },
  };
}
it('falls back when the bounded fast read cannot cover every active remit', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'synthetic'); base();
  try {
    const remits = Array.from({ length: 5 }, (_, i) => ({ id: String(i), goal: 'Goal ' + i }));
    const result = await routeWithJev('Stop preparing goal four', [], [], [], remits);
    expect(result?.decided).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});
it('a confident answer route cannot establish an uncertain preparation choice', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'synthetic'); base();
  evaluation.answers.prep_0 = { choice: 'pause', confidence: 0.48 };
  try {
    const result = await routeWithJev('The sponsor still has not replied', [], [], [], [{ id: 'sponsor', goal: 'Sponsor drafts' }]);
    expect(result?.decided).toBe(false); expect(result?.preparation).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});
