---
title: Separate epistemic confidence from freshness in retrieval scoring
date: 2026-07-28
last_updated: 2026-08-26
category: architecture-patterns
module: brain-retrieval
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - designing evidence scoring or confidence systems that conflate unrelated dimensions
  - "computing a single aggregate score from heterogeneous signals like truth confidence, temporal freshness, and retrieval utility"
  - mapping epistemic status across a retrieval boundary without preserving the source taxonomy
symptoms:
  - evidence scores conflate truth confidence with temporal decay (single librarianScore mixing reliability, recency, keyword density, interest boost)
  - "epistemic status is flattened — wiki entries with 8 distinct statuses (canon/working/speculative/questioned/unresolved/contradictory/dormant/episodic) all map to user_confirmed"
  - a single aggregate score hides the independence of confidence dimensions
  - old facts appear less credible because an age component is baked into the composite
tags:
  - memory-architecture
  - epistemic-integrity
  - confidence-dimensions
  - librarian
  - brain-retrieval
  - separation-of-concerns
  - retrieval-scoring
  - decay
---

# Separate epistemic confidence from freshness in retrieval scoring

## Context

Flyd's CLI brain retrieval pipeline had two design flaws that misrepresented the epistemic quality of retrieved memories to the intelligence layer. These were discovered during a deep validation of the memory architecture against the live codebase (July 2026).

**Flaw 1 — Epistemic status flattening:** `memoryEpistemicStatus()` in `cli/src/lib/brain-retrieval.ts:123-128` maps ALL wiki entries to `"user_confirmed"`, regardless of their actual `status` field. Wiki entries support 8 distinct states — canon, working, speculative, questioned, unresolved, contradictory, dormant, episodic — all lost at the retrieval boundary. A speculative or contradictory wiki claim crosses the boundary looking epistemically equivalent to something the user explicitly confirmed.

**Flaw 2 — Confidence conflation:** `scoreEvidence()` in `cli/src/lib/librarian.ts:39-85` computes a single composite `librarianScore` from `recencyWeight * 0.25 + reliabilityWeight * 0.35 + keywordDensity * 0.25 + interestBoost`. This collapses four orthogonal signals into one scalar: truth confidence (reliability), temporal freshness (recency), query relevance (keyword density), and user interest affinity (interest boost). The same conflation exists in Rails — `MemoryEdge#cite!` increments confidence by 0.05 on every access, treating retrieval frequency as corroboration.

(session history) The retrieval pipeline itself also had more basic failures — query poisoning from app/window metadata injected into BM25 search terms, empty compile-context bundles from missing confidence defaults, and personal context not being injected for first-person questions. These were fixed before the epistemic dimension work could be tackled. The `retrieveResilientLexicalBrainEvidence` pattern adds a per-keyword fan-out fallback layer that any future confidence dimension separation must compose with.

## Guidance

Separate confidence into five independent dimensions. Keep a composite for ranking, but preserve each dimension as a first-class field so consumers can reason about them independently.

```typescript
interface ConfidenceProfile {
  epistemicConfidence: number;   // source authority + corroboration - contradiction. NO age decay.
  freshness: number;              // temporal decay with per-type half-life
  interestAffinity: number;       // active interest topic/keyword overlap
  retrievalUtility: number;       // usage in similar contexts (deferred until RetrievalTrace exists)
  associationStrength: number;    // max graph edge confidence
}
```

The critical formula for epistemic confidence:

```
epistemicConfidence = max(0.1, rawConfidence + corroborationBoost - contradictionPenalty)
```

This contains **no `daysSince` term**. Temporal decay lives exclusively in `freshness`:

```
freshness = max(0, 1 - daysSince / halfLifeDays)
```

The composite for ranking is:

```
librarianScore = epistemicConfidence * 0.25 + freshness * 0.25 + relevanceTerm * 0.25
               + interestAffinity * 0.15 + associationStrength * 0.10
```

**Update (2026-08-26):** the relevance term and contradiction handling evolved when a generative verification layer was added. `relevanceTerm` is still `keywordDensity` heuristically, but when the LLM verifier runs (`flyd ask --librarian`), a relevant verdict sets it to 1 and irrelevant to 0.15 (`applyVerification()` in librarian.ts, shared weights in `weightedScore()`). Verified conflicts now apply the documented contradiction penalty with a recency tilt: the staler side of a conflicting pair loses −0.15/conflict, the fresher side −0.075 (cap 0.3) — so the more recent memory keeps more weight. The no-age-decay rule for epistemicConfidence still holds; the penalty derives from verified contradictions, not from age directly. Full pattern: `librarian-generative-verifier.md` in this directory.

At the retrieval boundary, map wiki statuses explicitly to preserve the full taxonomy:

| Wiki `status` | Epistemic status |
|---|---|
| `canon` | `verified` |
| `working` | `working_assumption` |
| `speculative` | `speculative` |
| `questioned` | `questioned` |
| `unresolved` | `unresolved` |
| `contradictory` | `contradictory` |
| `dormant` | `dormant` |
| `episodic` | `episodic` |

Raw captures without wiki elevation map to `observation`. Runtime corrections map to `user_confirmed`.

## Why This Matters

The core insight: **retrieval frequency and temporal staleness must not masquerade as diminished truth.**

- "My name is George" has high epistemic confidence indefinitely. No amount of time makes it less true.
- "Flyd's current branch is main" has high epistemic but low freshness when stale. Old repository state hasn't become epistemically dubious — it has become stale.

Conflating these dimensions causes the intelligence layer to make incorrect trust decisions. A canon fact retrieved infrequently ranks below a speculative claim that matches the current interest topic. A stale-but-true fact is silently demoted as if its truth weakened. By separating the dimensions, consumers can decide: "I need high epistemic confidence regardless of freshness" or "I need fresh context regardless of epistemic quality."

The same pattern was caught during planning in the Rails side — the `WorldStateCompiler` proposal initially used `compute_decay_score` (a temporal decay function) for `epistemic_confidence` instead of `belief.confidence`. The instinct to fold time into truth is pervasive and must be actively resisted wherever scoring functions combine heterogeneous signals.

## When to Apply

- When any scoring or ranking function mixes truth signals with freshness or relevance signals into a single number
- When a retrieval boundary maps stored status enums to simplified labels — keep all distinctions the storage layer makes
- When temporal decay logic lives in the same function or weight term as confidence computation
- When retrieval frequency or citation count is used to boost confidence (as in `MemoryEdge#cite!`)
- When designing any `Decayable` concern — decay must be per-type and compute freshness, not overwrite confidence

## Examples

**Before (conflated):**

```typescript
// librarian.ts:39-85 — single composite score
function scoreEvidence(entry: EvidenceEntry, keywords: string[], question: string): ScoredEvidence {
  const rawConfidence = Number(entry.metadata.confidence ?? (entry.source === "wiki" ? 0.9 : 0.5));
  const daysSince = entry.staleness?.daysSince ?? 0;
  const recencyWeight = Math.max(0, 1 - daysSince / 730);                    // temporal
  const reliabilityWeight = decayedValue(rawConfidence, daysSince, halfLife); // truth + temporal
  const interestBoost = matchesActiveInterest(entry) ? 0.15 : 0;             // affinity
  const keywordDensity = computeKeywordDensity(entry, question);             // relevance

  const librarianScore = Math.min(1,
    recencyWeight * 0.25 + reliabilityWeight * 0.35 + keywordDensity * 0.25 + interestBoost
  );
  return { ...entry, librarianScore, contradictionCount: 0 };
}
```

**After (separated dimensions):**

```typescript
// Five independent dimensions, composite for ranking only
function scoreEvidence(entry: EvidenceEntry, keywords: string[], question: string): ScoredEvidence {
  const rawConfidence = Number(entry.metadata.confidence ?? (entry.source === "wiki" ? 0.9 : 0.5));
  const daysSince = entry.staleness?.daysSince ?? 0;
  const halfLifeDays = getHalfLife(entry.metadata);

  const corroborationBoost = Math.min(0.2, entry.corroborationCount * 0.05);
  const contradictionPenalty = entry.contradictionCount * 0.1;

  const epistemicConfidence = Math.max(0.1, rawConfidence + corroborationBoost - contradictionPenalty);
  const freshness = Math.max(0, 1 - daysSince / halfLifeDays);
  const interestAffinity = matchesActiveInterest(entry) ? 0.15 : 0;
  const retrievalUtility = 0.5; // neutral baseline until RetrievalTrace exists
  const associationStrength = 0.0; // populated by graph augmentation

  const librarianScore = Math.min(1,
    epistemicConfidence * 0.25 + freshness * 0.25 + keywordDensity * 0.25
    + interestAffinity * 0.15 + associationStrength * 0.10
  );

  return {
    ...entry,
    librarianScore,
    confidenceProfile: {
      epistemicConfidence,
      freshness,
      interestAffinity,
      retrievalUtility,
      associationStrength,
    },
    contradictionCount: entry.contradictionCount,
  };
}
```

Status mapping at the retrieval boundary:

```typescript
// brain-retrieval.ts — before (flattened)
function memoryEpistemicStatus(entry: ScoredEvidence): "observation" | "user_confirmed" {
  if (entry.metadata.type === "conversation-index" || entry.metadata.promoted === false) return "observation";
  if (entry.source === "wiki") return "user_confirmed";
  if (entry.metadata.type === "flyd-runtime-task-corrected") return "user_confirmed";
  return "observation";
}

// After (taxonomy-preserving)
function memoryEpistemicStatus(entry: ScoredEvidence): string {
  if (entry.metadata.type === "conversation-index" || entry.metadata.promoted === false) return "observation";
  if (entry.metadata.type === "flyd-runtime-task-corrected") return "user_confirmed";
  if (entry.source === "wiki") {
    return WIKI_STATUS_MAP[entry.metadata.status as string] ?? "working_assumption";
  }
  return "observation";
}

const WIKI_STATUS_MAP: Record<string, string> = {
  canon: "verified", working: "working_assumption", speculative: "speculative",
  questioned: "questioned", unresolved: "unresolved", contradictory: "contradictory",
  dormant: "dormant", episodic: "episodic",
};
```

## Related

- `docs/plans/2026-07-28-003-feat-unified-memory-architecture-plan.md` — U2 (separate confidence dimensions in librarian scoring), U1 (fix epistemic status flattening), U9 (same fix on Rails side)
- `cli/src/lib/brain-retrieval.ts:123-128` — `memoryEpistemicStatus()` status flattening
- `cli/src/lib/librarian.ts:39-85` — `scoreEvidence()` confidence conflation
- `cli/src/lib/decay.ts:6-16` — half-life constants used by `decayedValue()`
- `app/models/memory_edge.rb` — Rails `cite!` confuses retrieval with corroboration
- `app/models/concerns/decayable.rb` — temporal decay concern (used for freshness, not epistemic confidence)
