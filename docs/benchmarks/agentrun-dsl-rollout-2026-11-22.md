# Flyd × AgentRun DSL: CoS recovery implementation and rollout evidence

**Date:** 2026-11-22  
**PR:** [#337](https://github.com/GeorgeGally/flyd/pull/337)  
**Plan:** [2026-11-15 AgentRun DSL + System-1 plan](../plans/2026-11-15-agentrun-dsl-system1-decision-workflows-plan.md)  
**Status (updated 2026-11-23):** George requested activation. The **compatible-Node Core defaults to active AgentRun recovery** for eligible CoS runs, and `make install` provisions the pinned package in an isolated directory. An incompatible Core remains on legacy recovery. This repository activation is **not proof the installed Mac has been rebuilt or is running Node 24**; live-provider calibration, real-workload quality and rollout acceptance remain unproven.

## Delivered in this revision

- **P2:** One fixed, versioned AgentRun v2 document in `cli/src/command/cos/decision-workflows/recovery-workflow.ts`. Its only external host tool is an **in-memory/read-only view of an already-classified internal CoS run**. It uses the existing `cos_recovery_tactic` System-1 predicate, a host-pinned 0.8 threshold, and returns only `rebrief` or `hold`. It cannot dispatch, push, send, pay, delete or claim an objective. It is a conservative inner procedure; it never replaces CoS scheduling, FirstMate or domain verifiers.
- **P3:** `judgeRecovery` now delegates eligible recovery to the optional runtime behind `FLYD_COS_DECISION_DSL`. Legacy remains the default and fallback when the interpreter is unavailable before a model call. Explicit shadow only compares judgments without controlling work. Canary assignment is deterministic by objective/run, stable across retries.
- **P3 durability:** Uses the **existing canonical IntelligenceEventStore** (no second journal), a transactionally claimed `started` event before the model call, and an awaited `answered` decision receipt before branching. If a request started without a confirmed answer, a restarted or concurrent CoS run **holds rather than re-sending it**. Complete, version-bound decisions are reused without another provider call. The audit stores hashes, categorical outcomes, numeric confidence policy and cost metadata—not raw `state`, prompts, email, model errors or decision exchange.
- **P3 authority:** CoS's existing `canRecoverInternally` floor still vetoes outward and unconfirmed effects before invoking DSL. The source and decision are rechecked against the current objective revision and per-run attempt count. Output is a recommendation; CoS continues to own dispatch, verification, idempotency and reporting.
- **P3 private reasoning:** If and only if a model is inconclusive rather than explicitly requesting an evidence hold, `FLYD_COS_DSL_PRIVATE_REASONING=1` may invoke Flyd's existing private strategic resolver **once per objective revision/run attempt**. A canonical pre-call marker prevents repeat requests after a crash. This never escalates to George automatically; a returned tactic still has to pass CoS's internal-only admission and revision checks.
- **P4:** 100 reproducible **synthetic** negative-control episodes in `experiments/agentrun-dsl/rollout-eval.ts`. These check control flow, strict gate thresholds, malformed/unknown provider responses, protected work, attempt caps, stale objectives and unwanted extra provider calls under the **real pinned interpreter**. They are explicitly **not** an independent labeled task-success holdout or representative runtime/cost benchmark.
- **P5:** `off / shadow / canary / on` modes and immediate rollback to legacy. After George's 2026-11-23 instruction, compatible Node >=24.22.3 Core defaults to `on` when CoS is enabled. The Mac installer installs and tests pinned `@parcha/agentrun-dsl@0.1.0-beta.43` under the isolated `experiments/agentrun-dsl` directory (not inside Core's Node 22 dependency graph). Core loads that exact version; incompatible Node and missing packages fail to the legacy path. No second server or background worker is introduced.
- **P6 (candidate-only):** `proposeRecoveryPlaybooks` can return **inert review candidates** from at least three distinct, independently measured positive recovery episodes and rejects negative, unmeasured and mismatched-policy evidence. It does not write policies, create executable workflows, broaden grants or self-promote. Existing PolicyRegistry/replay/learning must still approve any future revision.

## Correct run and feature flags

**Now enabled by default** when `FLYD_COS=1`, Core runs Node **24.22.3+**, and the pinned package is resolvable. The Mac install step provisions the package automatically only when the selected Node meets this requirement; on Node 22 the legacy handler remains unchanged. To observe the actual outcome, restart Core and inspect its `[Flyd Core] CoS AgentRun recovery: ACTIVE|LEGACY` startup log.

| Setting | Meaning |
| --- | --- |
| `FLYD_COS=1` | Existing CoS must be active |
| `FLYD_COS_DECISION_DSL=off` | Explicit immediate rollback to legacy CoS recovery |
| `FLYD_COS_DECISION_DSL=shadow` | Existing CoS alone owns the decision; no shadow model call unless explicitly budgeted |
| `FLYD_COS_DSL_SHADOW_CALLS=1` | Opts into an additional shadow model judgment and categorical comparison |
| `FLYD_COS_DECISION_DSL=canary` | Uses the DSL only in a deterministic, allowed objective/run cohort |
| `FLYD_COS_DSL_CANARY_PERCENT=5` | Example configured 5% cohort; default 0%, so no production selection |
| `FLYD_COS_DECISION_DSL=on` | Now the default on a compatible Node when no explicit mode is set. Existing scoped authority and protected-effect vetoes still apply |
| `FLYD_COS_DSL_PRIVATE_REASONING=1` | Opt-in bounded one-shot private reasoning only after low-confidence System-1; off by default |
| `FLYD_COS_DSL_MODULE=file:///absolute/path/to/.../dist/index.js` | Optional administrator-supplied exact package import location. If unset, resolve the installed `@parcha/agentrun-dsl` ESM package. In both cases package metadata must match `0.1.0-beta.43` |

When the runtime is incompatible, missing or cannot be imported, DSL is unavailable before any model call and CoS falls back to its existing handler. When an invocation **may already have been sent**, the DSL **holds**, never retries through the legacy handler. No flag implies permission to perform an outward effect.

### Installation and runtime verification (2026-11-23)

From the actual Flyd source checkout on the Mac:

```sh
cd mac-adapter
make run
# Observe the Core's log after restart:
# [Flyd Core] CoS AgentRun recovery: ACTIVE (mode=on, Node=24.22.3+ ...)
# If LEGACY, select/install compatible Node >=24.22.3 and re-run make run.
```

The Swift app starts Core through a login shell, so the **Core's Node** can differ from the interactive terminal's Node. `make run` installs and verifies the pinned interpreter only when the terminal's selected Node is compatible; it never upgrades Node, changes secrets, or modifies firstmate. An app that adopts an already-running older Core must be restarted before this can be counted as active. To roll back without changing the repository: set `FLYD_COS_DECISION_DSL=off` in the Core process environment and restart Core. Activation alone is **not** verification of improved real-world decisions.

### Reproducible tests

```sh
cd cli
npm ci
npm run lint
npx vitest run src/command/__tests__/cos-decision-workflows.test.ts \
  src/command/__tests__/cos-dsl-rollout.test.ts \
  src/command/__tests__/cos-dsl-playbook.test.ts \
  src/command/__tests__/cos-recovery.test.ts
npm test
npm run build

# Only in a compatible, isolated Node >=24.22.3 environment:
cd ../experiments/agentrun-dsl
npm install --package-lock=false --ignore-scripts
npm test
cd ../../cli
npx tsx ../experiments/agentrun-dsl/rollout-integration.ts
npx tsx ../experiments/agentrun-dsl/rollout-eval.ts
```

GitHub Actions [AgentRun DSL feasibility](../../.github/workflows/agentrun-dsl-probe.yml) runs the exact interpreter tests; the main CI runs Core, evidence, planning and mac-adapter regression checks. CI success is not proof of a Mac's installed Core runtime or true provider accuracy.

## Hard release gates still open

1. **Real Mac service executable:** Confirm the Node version and package path of *the actual Core process* (not just terminal `node --version`). If it is Node 22, migrate Core deliberately with full installer, LaunchAgent, Swift adapter and rollback acceptance—**do not** force-import AgentRun on Node 22.
2. **Verified real workload:** Collect consented, redacted CoS recovery episodes showing the recurring multi-step procedure actually reduces full reasoning calls, latency or unnecessary interruptions versus current TypeScript + Jev. Do not promote a syntactic JSON rewrite.
3. **Frozen independent holdout:** At least 100 independently labeled real or representative decision cases. Compare baseline, AgentRun + Jev, AgentRun + Gemini (only if complete answer distributions are available), and deterministic fallback under matching source projections and provider budgets. Synthetic `rollout-eval.ts` is not this gate.
4. **Protected fault drills:** Test actual installed Mac kill/restart before/after request, after receipt/before CoS commit, user correction, revoked source, concurrent tick, and an unknown external-effect receipt. There must be zero unapproved external effects, duplicate dispatches, source leaks or false completion.
5. **Canary outcome:** Verify a real completed internal objective, no added George interruption, cost/latency budget, and immediate `FLYD_COS_DECISION_DSL=off` rollback. A passed benchmark alone is not an activated policy.
6. **Learning promotion:** Only after the above, feed positive, independently verified episodes into the existing PolicyRegistry with a predeclared metric and frozen train/holdout. Candidate evidence never promotes itself.

**Rollout decision:** George explicitly authorized turning on the bounded recovery workflow. Repository activation is now **on by default on compatible Core**, with `off` immediately restoring the legacy handler. The installed Mac cannot be declared active until its Core Node/package status and logged readiness are checked; the independent live-outcome gates remain open.

## Safety invariants

No new CoS graph, no new FirstMate, no outbound tools, no arbitrary workflow authoring, no Node upgrade under a user process, no unreviewed dynamic code nodes, no user-facing approvals for routine technical choices, no raw source/prompt/model-error receipt storage, and no authorization from an AgentRun confidence score alone.
