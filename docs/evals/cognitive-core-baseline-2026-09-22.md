# Cognitive Core baseline and release eval — 2026-09-22

## Purpose

This eval is the release gate for the Cognitive Core plan. It measures whether Flyd establishes current state, temporal validity, referents, project grounding, and epistemic uncertainty before deeper retrieval or action.

The machine-readable fixture is:
`cli/src/cognition/__tests__/fixtures/intelligence-benchmark.json`.

## Baseline failures that motivated the release

Before this work, active model paths assembled context independently. Current work could be inferred only after a query, literal user text was often used as the memory query, short referents were weak, and once-correct action memories could remain relevant after their event ended.

Canonical regression: GNM3 happened on 5 September 2026, but an old sponsorship task could still surface as current advice roughly two weeks later.

## Hard release invariants

1. GNM3 sponsorship is excluded from present advice after GNM3 completes.
2. The same sponsorship claim remains available to historical questions.
3. Terminal parent lifecycle state propagates through `valid_for` relationships.
4. Supersession preserves old claims as history.
5. Contradiction is surfaced as uncertainty; neither side is silently deleted.
6. Jev output is evidence only. Low confidence, failure, timeout, or absence cannot mutate canonical state.
7. PROFILE, NOW, and project Markdown are rebuildable projections over the event/claim/relation model.
8. Overlay resolution, Work Intelligence, CLI conversation, task planning, coding memory, and LIVE use the Cognitive Core read path.
9. Present is materialized from durable work/git/task signals; quiet macOS PRESENT sensing remains zero-persistence.
10. Every current recommendation filters expired/completed/cancelled/superseded actionable claims.

## Scoring dimensions

Model-dependent benchmark runs should score each applicable prompt on a 0/1 basis for:
- referent resolution
- temporal correctness
- currentness
- project awareness
- recall
- uncertainty handling
- useful initiative
- evidence grounding
- stale-action avoidance

Deterministic invariants are covered in Vitest and must pass before qualitative scoring is considered.

## Verification note

This document does not invent a numeric baseline. The pre-release qualitative failures above are code- and dogfood-observed. Record model-run scores here only when the benchmark is executed in a configured Flyd environment.
