# AgentRun DSL P0 implementation record — 17 November 2026

**Status: isolated feasibility and strict System-1 contract implemented; production integration NOT approved or enabled.**

**Branch / PR:** [feat/agentrun-dsl-p0-system1-contract](https://github.com/GeorgeGally/flyd/pull/325).  
**Validated plan:** [Flyd × AgentRun DSL](../plans/2026-11-15-agentrun-dsl-system1-decision-workflows-plan.md).  
**Upstream examined:** Parcha-ai/agentrun source main 3300e9f15d4ff940996eb3947755cf03bde8df74, package version 0.1.0-beta.43.  
**Flyd base:** 248786d0a418133de4280471639209c9d36cb0bb.

## What was implemented

1. A **non-production, version-pinned interpreter test** at `experiments/agentrun-dsl/`. The test installs real `@parcha/agentrun-dsl@0.1.0-beta.43` on **Node 24.22.3**, compiles a trusted v2 document, reads simulated permitted evidence, evaluates a scripted choice, gates on 0.80 confidence/probability, and returns a typed *candidate* to CoS. It refuses malformed answers and does not retry an interrupted provider call. No API keys, external effects or raw user data are involved.
2. Separate [GitHub Actions feasibility workflow](../../.github/workflows/agentrun-dsl-probe.yml); no dependency is added to Flyd Core's Node 22 package graph.
3. An unactivated **strict choice-only adapter** at `cli/src/command/cos/decision-workflows/system-one-contract.ts`. It admits only the exact registered `cos_recovery_tactic` question/criteria and projected fields, uses the existing `evaluateExecutivePredicates` and egress contract, validates complete answer distributions, applies Flyd's own registered threshold, and distinguishes preflight rejection from unknown provider outcome.
4. Negative-control tests under `cli/src/command/__tests__/cos-decision-workflows.test.ts`.

## Reproducible checks

- [Isolated interpreter run 44052427157](https://github.com/GeorgeGally/flyd/actions/runs/44052427157): **success** on Node 24.22.3, real pinned interpreter, deterministic scripted decisions. This is an observed CI result; no live decision quality is implied.
- Flyd Core full CI: refer to [PR #325 checks](https://github.com/GeorgeGally/flyd/pull/325/checks) for final status; the initial record is not evidence of a green Core suite.
- No installed Mac or Hetzner Core runtime was remotely accessed or tested.
- No real Jev or Gemini call, production calibration, privacy consent episode, full 100-case benchmark, or developer-observed human interruption metric was run. Do **not** fill in invented numbers.

## Explicit P0 gate assessment

| Gate | Evidence | Status |
| --- | --- | --- |
| Exact AgentRun interpreter installs/runs on supported Node | Isolated pinned beta.43 GitHub Actions test | **Passed in CI** |
| Existing Flyd Core Node 22 unaffected | No package/lockfile/runtime changes; separate experiment | **Protected** |
| Installed Mac Core runtime is compatible | Cannot inspect installed Mac from this GitHub-only environment | **Open / blocking** |
| Exact current package and runtime on Hetzner, if used | Not inspected | **Open / blocking if relevant** |
| Real repeatable two-stage CoS decision exists and needs DSL | Synthetic read → judge → route example only | **Open / blocking** |
| Real Jev/Gemini distribution and unknown-outcome contract | Only source inspection and injected fake responses | **Open / blocking** |
| 100-case frozen holdout and representative baseline | Not available in this environment | **Open / blocking** |
| End-to-end CoS safety, recovery, crash, canary | No production code path changed | **Deferred until prior gates** |

**Decision: GO for source-level adapter/probe work; NO-GO for production activation or package installation in Flyd Core yet.** This follows the already-approved plan's own hard-stop rules rather than bypassing them.

## Required next engineering action on the actual machine

Verify the executable behind Flyd Core and its service launch, not just a shell's default `node`:

```sh
node --version
cd cli && node --version && npm run lint && npm test
# In a separate scratch directory only; requires Node >=24.22.3:
cd experiments/agentrun-dsl && npm install --package-lock=false && npm test
```

Then gather an actual *multi-step* CoS recovery trace and the old path's full-agent calls, latency, cost and verified outcome. Compare an equivalent hand-coded TypeScript implementation to DSL before deciding whether the added dependency is justified. If the installed runtime is Node 22, do not upgrade it unilaterally: choose a deliberate Core migration or leave AgentRun disabled.

## What is not claimed

No production integration, learned workflow promotion, real live canary, Node upgrade, user-visible improvement, concurrency/restart guarantee, cost savings or completed implementation of P2–P6 has occurred.

**Authority:** CoS and the Flyd PRD remain unchanged. A passed synthetic interpreter test is not an effect grant, evidence of improved model judgment, or permission to install a new runtime.
