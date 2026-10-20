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
