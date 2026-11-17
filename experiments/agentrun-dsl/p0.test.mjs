/**
 * P0: isolated, deterministic AgentRun interpreter smoke test.
 * Does not call an external model or perform an outward action.
 * This does NOT assert production Node compatibility, improved answer quality
 * or measured Jev speed. The real Flyd CoS remains completely unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow, validateWorkflow, inspectWorkflow } from '@parcha/agentrun-dsl';

const workflow = {
  v: 2,
  name: 'flyd-internal-recovery-p0',
  schemas: {
    Input: {
      type: 'object', additionalProperties: false,
      properties: { sourceKey: { type: 'string' }, summary: { type: 'string' } },
      required: ['sourceKey', 'summary'],
    },
    Evidence: {
      type: 'object', additionalProperties: false,
      properties: { source: { type: 'string' }, verified: { type: 'boolean' } },
      required: ['source', 'verified'],
    },
    Decision: {
      type: 'object', additionalProperties: false,
      properties: {
        tactic: {
          type: 'string',
          enum: ['rebrief_with_different_tactic', 'hold_for_evidence'],
          description: 'Given the known internal failure and evidence, select a bounded recovery tactic; this does not authorize effects.',
          criteria: {
            rebrief_with_different_tactic: 'A justified different internal repair should be attempted.',
            hold_for_evidence: 'More evidence or investigation is needed.',
          },
        },
      },
      required: ['tactic'],
    },
    Result: {
      type: 'object', additionalProperties: false,
      properties: { kind: { type: 'string' }, reason: { type: 'string' } },
      required: ['kind', 'reason'],
    },
  },
  input: { schemaId: 'Input' },
  output: { schemaId: 'Result', path: 'result' },
  root: {
    node: 'chain',
    steps: [
      { node: 'call', label: 'existing-evidence-only', via: 'tool', tool: 'source.read',
        args: { key: '{sourceKey}' }, out: 'Evidence', as: 'evidence', deadline_s: 5 },
      { node: 'judge', label: 'choose-internal-tactic',
        state: { source_kind: 'domain_failure', summary: '{summary}', evidence_refs: '{evidence.source}' },
        out: 'Decision', as: 'decision' },
      { node: 'code', label: 'apply-host-threshold',
        code: "(s) => { const a = s['decision$answers']?.answers?.tactic; const allowed = s.evidence.verified === true && a?.type === 'choice' && a.choice === 'rebrief_with_different_tactic' && a.confidence >= 0.8 && a.probabilities?.[a.choice] >= 0.8; return { route: allowed ? 'rebrief' : 'hold' }; }" },
      { node: 'route', label: 'return-recommendation', valuePath: 'route', otherwise: 'hold', branches: {
        rebrief: { body: { node: 'code', label: 'rebrief-disposition',
          code: "() => ({ result: { kind: 'rebrief', reason: 'Candidate only; CoS must authorize and verify.' } })" } },
        hold: { body: { node: 'code', label: 'hold-disposition',
          code: "() => ({ result: { kind: 'hold', reason: 'Insufficient permitted evidence or model confidence.' } })" } },
      } },
    ],
  },
};
const input = { sourceKey: 'existing:internal-r1', summary: 'A unit test failed after an internal code edit' };

function harness({ probability = 0.94, confidence = 0.93, verified = true, malformed = false } = {}) {
  const calls = { effect: 0, judge: 0, receipts: [] };
  const deps = {
    async runEffect({ node, input: args }) {
      calls.effect++;
      assert.equal(node.tool, 'source.read');
      assert.equal(args.key, input.sourceKey);
      return { source: 'domain-run:r1', verified };
    },
    async runJudge({ questions, state }) {
      calls.judge++;
      assert.deepEqual(Object.keys(questions), ['tactic']);
      assert.equal(state.source_kind, 'domain_failure');
      return {
        answers: { tactic: {
          type: 'choice',
          choice: 'rebrief_with_different_tactic',
          probabilities: malformed
            ? { rebrief_with_different_tactic: probability }
            : { rebrief_with_different_tactic: probability, hold_for_evidence: 1 - probability },
          confidence,
        } },
        model: 'scripted-no-network',
        cost_usd: null,
      };
    },
    async recordDecision(receipt) {
      // Real host must use the existing governed event store; never write raw receipt state.
      calls.receipts.push({
        id: receipt.id, status: receipt.status, kind: receipt.kind,
        state_sha256: receipt.state_sha256,
      });
    },
  };
  return { deps, calls };
}

test('AgentRun v2 schema validates under its actual installed interpreter', () => {
  const validation = validateWorkflow(workflow);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  assert.ok(inspectWorkflow(workflow));
});

test('read-only evidence, strict judgment and a typed CoS recommendation run end to end', async () => {
  const { deps, calls } = harness();
  const result = await runWorkflow(workflow, input, deps);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.output, {
    kind: 'rebrief', reason: 'Candidate only; CoS must authorize and verify.',
  });
  assert.equal(calls.effect, 1);
  assert.equal(calls.judge, 1);
  assert.equal(calls.receipts.length, 1);
  assert.equal(calls.receipts[0].status, 'answered');
  assert.equal(Object.keys(calls.receipts[0]).includes('state'), false);
});

test('confidence below Flyd policy and unverified evidence hold without rerunning', async () => {
  for (const args of [{ probability: 0.5 }, { confidence: 0.79 }, { verified: false }]) {
    const { deps, calls } = harness(args);
    const result = await runWorkflow(workflow, input, deps);
    assert.equal(result.status, 'complete');
    assert.equal(result.output.kind, 'hold');
    assert.equal(calls.effect, 1);
    assert.equal(calls.judge, 1);
  }
});

test('malformed choice distribution never produces a downstream recommendation', async () => {
  const { deps, calls } = harness({ malformed: true });
  await assert.rejects(() => runWorkflow(workflow, input, deps));
  assert.equal(calls.effect, 1);
  assert.equal(calls.judge, 1);
  assert.equal(calls.receipts[0]?.status, 'failed');
});

test('provider interruption does not retry or dispatch a recovery', async () => {
  let judgeCalls = 0;
  const { deps } = harness();
  deps.runJudge = async () => {
    judgeCalls++;
    throw new Error('outcome_unknown; never retry an unconfirmed send');
  };
  await assert.rejects(() => runWorkflow(workflow, input, deps));
  assert.equal(judgeCalls, 1);
});
