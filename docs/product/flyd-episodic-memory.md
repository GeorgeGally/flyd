# Flyd episodic memory

Flyd's canonical personal history is the append-only `IntelligenceEventStore`. Episodic memory is a disposable projection over that evidence spine, inspired by OptMem's lossless-log/lossy-view architecture.

## Invariants

- Events are evidence. Episode summaries are interpretations and may always be deleted and rebuilt.
- No episode summary is a source of truth and no production write path targets the episodic cache.
- Tree identity is deterministic from canonical event order. Erased events remain structural placeholders while their payloads are excluded.
- The temporal tree is one global aligned binary forest. Projects, entities, taste and world state remain separate semantic projections rather than separate physical trees.
- Recent history receives finer context resolution through a bounded temporal cover; old history collapses into coarser nodes.
- `drill` moves from a summary to child summaries and finally to original event evidence.
- Missing or stale summaries must never block an interactive Flyd response.
- Source erasure invalidates the episodic derived surface; rebuilding regenerates summaries from surviving evidence.
- Summary generation is versioned and replaceable. The baseline summarizer is deterministic so the data structure can be tested without a live model.

## Current scope

The episodic core is intentionally shadow/debug-only. It does not yet change `queryMemory()` or production answer context.

Commands:

```bash
flyd episodes rebuild
flyd episodes timeline --budget 12
flyd episodes drill episode:0:0-1
flyd episodes verify
```

Implementation: `cli/src/intelligence/episodes/`.

The next rollout gate is empirical: compare current Flyd recall against current + episodic cover and current + episodic drill on historical/evolution questions before enabling production context injection.


## Historical recall benchmark

The episodic projection cannot enter normal Flyd recall until it beats the current memory path on a frozen benchmark drawn from George's own canonical event history. Private benchmark cases are stored locally under `~/.flyd/evals/episodes/`, never committed.

Seed (or deliberately reseed) a frozen corpus:

```bash
cd cli
npm run evals:episodes:seed -- --count 12
```

Each generated case contains a user-style historical question, concise gold answer, grading rubric, and exact canonical event sequences that support it. Categories cover what happened, evolution, decisions, changes, and historical state.

Run all three strategies against exactly the same cases and answer/judge models:

```bash
npm run evals:episodes
npm run evals:episodes -- --model <model> --judge <judge-model>
npm run evals:episodes -- --only history-01,history-04
```

Strategies:

1. `current` — today's `queryMemory()` behavior.
2. `cover` — current memory plus a bounded recency-weighted episode cover.
3. `cover-drill` — cover plus deterministic query-guided descent to original event evidence.

The report records judge quality, pass rate, exact evidence recall, median latency, and context size for each strategy. Raw per-case results are saved under `~/.flyd/evals/episodes/runs/`.

Promotion is explicit rather than subjective:

```bash
npm run evals:episodes -- --gate
```

`cover-drill` passes only when it improves mean judged answer quality by at least 0.5/10, does not regress passed cases, and stays within bounded latency and context-growth ceilings. A failed gate exits nonzero and production recall remains unchanged. A passed gate earns only the next rollout step: shadow production context, not automatic answer injection.
