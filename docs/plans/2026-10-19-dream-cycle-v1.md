# Dream Cycle V1 — experience consolidation

**Date:** 2026-10-19  
**Status:** implementation plan + first slice

## Goal

Give Flyd an offline consolidation loop that learns from its own canonical experience without creating another memory authority.

The first slice is intentionally narrow: **experience consolidation only**. It reads `experience.runtime` traces and explicit correction events, detects repeated operational patterns, and writes compact evidence-linked candidate insights back into the same canonical erasure domain.

## Architectural decision

Dreaming is a **powerless analyst**, not another brain.

```text
turns / tools / corrections
        ↓
experience.runtime events
        ↓
Dream Cycle (daily, incremental)
  replay · cluster · consolidate
        ↓
dream_insight observations
        ↓
existing governed consumers
  self-improve / later replay
```

It does **not**:

- rewrite `USER.md`, `MEMORY.md`, TASTE, project state, or canonical claims;
- promote a policy;
- change prompts;
- dispatch code;
- infer success from silence;
- create a second database.

## V1 inputs

Canonical `experience.runtime` events:

1. `experience_trace`
   - route;
   - memory verdict;
   - tools and failures;
   - retry count;
   - turn execution status;
   - model/policy metadata.

2. `experience_feedback`
   - explicit correction;
   - failure classes;
   - repair targets;
   - causal receipt id.

Raw answer text, tool inputs, and correction prose are not copied into Dream insights.

## V1 insights

### Correction cluster

Emit only after at least **3** related explicit corrections.

The cluster signature uses the specific failure classes / repair targets plus route. Generic `answer_quality` / `behavioral regression evaluation` labels are ignored when a more specific class exists.

### Repeated objective failure

Emit only after at least **3** equivalent objective execution failures:

- failed turn;
- failed tool call;
- retry after failure.

### No inferred success

A succeeded turn with no complaint is **not** evidence that a strategy worked. Positive strategy learning waits for verified outcomes / mature episode attribution.

## Milestones and idempotency

Insights are emitted only when support crosses a bounded milestone:

- 3 occurrences;
- 5 occurrences;
- 10 occurrences.

The idempotency key is:

`schema + kind + pattern signature + milestone`.

Re-running against the same event head emits nothing new. A pattern can therefore produce at most three V1 insight events.

## Provenance and deletion

Every Dream insight includes exact `event:<sequence>` evidence refs and is written under the existing `experience.runtime` source id.

That is deliberate: if the experience source is erased, its derived Dream insights are erased in the same source domain rather than surviving as an orphaned summary.

## Scheduling

- Existing Core agenda scheduler owns the lifecycle.
- Run at most once every ~20 hours.
- First run handles the backlog.
- File lease prevents two Core processes from dreaming at once.
- Canonical projector checkpoint tracks the last processed experience sequence.
- `FLYD_DREAM=0` disables the cycle.

No new daemon or cron system.

## Consumer boundary

V1 failure/correction insights are eligible evidence for the existing governed `self-improve` loop.

That loop still:

- chooses at most one concrete change;
- requires evidence;
- dispatches coding work to a branch;
- verifies the result;
- does not land without the existing gate.

Dreaming itself never acts.

## Acceptance tests

1. One correction produces no generalized insight.
2. Three related corrections produce exactly one candidate.
3. Re-running the same event head produces no duplicate.
4. Three equivalent objective tool failures produce one repeated-failure insight.
5. Insight payload contains no original answer, tool input, or correction prose.
6. Insight carries source event references.
7. Existing source erasure semantics cover Dream insights because they share the `experience.runtime` source domain.
8. Scheduler failure is best-effort and cannot break normal Flyd work.

## Next slices — explicitly not in V1

### V2 — belief health

Consume existing world-model conflicts, stale entities, and unresolved dependencies. Re-check evidence and append only evidence/relations; never silently upgrade inference to user-confirmed truth.

### V3 — episode materialization

Wire mature intervention/outcome chains into the existing replay and policy-registry machinery. Dreaming may prepare candidates; existing promotion gates remain authoritative.

### V4 — canonicalize Librarian output

Move durable Librarian writes toward canonical event proposals, with `MEMORY.md` as a projection rather than a second durable truth store.

## Rollout

Ship V1 enabled by default because it is deterministic, local, read-mostly, bounded, and powerless. Dogfood the resulting insights before adding any LLM-based dream task.
