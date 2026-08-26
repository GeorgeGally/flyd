---
title: Layer generative verification over deterministic memory scoring
date: 2026-08-26
category: architecture-patterns
module: cli/src/lib/librarian-verifier.ts
problem_type: architecture_pattern
component: assistant
severity: medium
applies_when:
  - "a deterministic heuristic (keyword overlap, substring match) is doing work that requires understanding meaning"
  - "LLM-generated content will be persisted or promoted to durable state"
  - "an existing numeric scoring model can absorb an LLM judgment as one weighted term instead of being replaced"
  - "verifier failure must degrade gracefully to a sane heuristic fallback"
tags:
  - librarian
  - genrm
  - llm-verification
  - memory-ranking
  - verify-before-promote
  - fail-open
  - conflict-detection
related_components:
  - tooling
---

# Layer generative verification over deterministic memory scoring

## Context

Flyd's personal-memory librarian ranked retrieved memories with fixed formulas, and three failures compounded:

1. **Relevance was keyword arithmetic.** `scoreEvidence()` computed relevance as substring keyword density — question words appearing in the body. A memory phrased differently from the question scored near zero even when it was the answer; a memory sharing many words but answering something else scored high.
2. **Contradiction detection never fired.** Detection relied on verbatim substring containment, which in practice never matched real conflicting memory pairs. Contradicting memories about the same fact surfaced side by side with no penalty.
3. **Ingest trusted AI output unverified.** `runBatchIngestSlice → executeIngestPlan` wrote AI-generated wiki pages straight into permanent memory at `confidence: high`. Hallucinated facts became permanent curated truth.

The gap in one sentence: deterministic string-matching heuristics were doing semantic judgment work, and generative output was written to durable storage without a semantic check on either end.

## Guidance

Keep cheap deterministic scoring for ordering; add one bounded LLM verification pass whose verdicts blend into (not replace) the scores; gate all writes to permanent memory behind traceability checks; fail open everywhere, visibly.

Implemented in commits cccd713..344b084 (Aug 2026), inspired by arXiv 2408.15240 (GenRM: reward modeling as next-token prediction).

### One verifier module, two jobs

`cli/src/lib/librarian-verifier.ts` exposes:

- `verifyEvidence(entries, question)` — a single CoT LLM call judges which memories actually answer the question. Returns per-entry `{relevant, reason}` verdicts, an overall sufficiency verdict (`sufficient|partial|conflicting|insufficient`), and verified conflicts as `(pathA, pathB, reason)` triples.
- `verifyIngestPlan(proposals, captures)` — judges each proposed page as `justified | invented | borderline` against the source captures ("the only permitted factual basis").

Mechanics worth copying:

- **Prompt-injection framing**: the system prompt states all memory/capture text is untrusted data, never instructions.
- **Strict response validation**: JSON extracted by regex; every returned path must exist in the proposed set; unknown enums rejected; empty verdict map treated as unusable.
- **Timeout-bounded calls**: `withTimeout()` wrapper honoring `FLYD_VERIFY_TIMEOUT_MS` (default 60s), timer `.unref()`'d.
- **Fail-soft contract**: timeout or unusable output returns `{verified: false}`; callers fall back to pure heuristics and log to stderr so degradation is observable.
- **Match the planner's view**: capture truncation in the verifier matches what the planner saw (1000 chars). The verifier must see what the planner saw, or justified pages get falsely judged invented.

### Blend, don't replace

Only the one weight representing semantic relevance is swapped. Freshness, interest affinity, and graph association stay formula-based:

```ts
const relevanceTerm = verdict.relevant ? RELEVANT_TERM : IRRELEVANT_TERM; // 1 vs 0.15
const librarianScore = weightedScore(epistemicConfidence, freshness, relevanceTerm, affinity, association);
```

The composite weights live once in `weightedScore()` (librarian.ts), shared by heuristic and blended paths.

Verified conflicts feed back into `epistemicConfidence` (per the documented formula authority + corroboration − contradiction): staler side of a pair −0.15/conflict, fresher side −0.075, capped at 0.3, floored at 0.1 — so within a conflicting pair, the more recent memory keeps more weight.

### Verify-before-promote write gate

`gateIngestPlan()` in `cli/src/lib/ingest.ts`, called after plan parse and outside its try/catch (a gating throw must not discard the batch):

- Pages judged `invented` are dropped pre-write with the reason logged.
- Dangling edges filtered: contradictions/crossLinks keep only entries whose both endpoints survived.
- Fall-open marks `plan.unverified`; `executeIngestPlan` then writes new pages via `createTopicPage({ unverified: true })` → `promoted: false` + `confidence: low` — lowest retrieval authority instead of silent trust.
- Known ceiling: unverified *updated* pages cannot be downgraded in place without rewriting frontmatter; they land as-is with a loud warning.

### Spend test-time compute only where uncertain

Borderline ingest pages get exactly two revotes with different framings ("skeptical auditor" vs "honest but generous reviewer"); promotion requires strict majority-of-3 `justified`; unresolved drops. Clear-cut verdicts get no extra calls.

```ts
// ponytail: same model, different prompts — true independence needs a
// second model in the vote; add if correlated verdicts show up in practice.
```

### Testing LLM-dependent logic without a provider

Use the `FLYD_MODEL_FIXTURE` seam in `llm.ts`: env var holds inline JSON rules matched against prompts by substring. Unmatched prompts throw loudly rather than silently passing via fallback. No network, no mock framework.

## Why This Matters

- **Semantic recall without semantic cost at query time**: retrieval ranking stays O(string ops); one extra LLM call replaces the weakest 0.25-weight term with actual comprehension, fixing differently-phrased answers and word-bait false positives simultaneously.
- **Hallucination stops at the write boundary**: invented pages never reach permanent memory; unverifiable ones land at lowest authority. Archive integrity becomes a property of the pipeline, not of the model's good behavior.
- **Blast radius is bounded**: every LLM dependency is timeout-capped, output-validated, and fail-soft. A downed model degrades to yesterday's behavior — never a crash, never a blocked batch.
- **Cost scales with uncertainty**: revotes run only for borderline pages.

## When to Apply

All of these should hold:

- A deterministic heuristic is doing work requiring understanding meaning, with known observable failure modes (false negatives from paraphrase, false positives from vocabulary overlap).
- An LLM generates content that will be persisted or promoted to durable state.
- An existing numeric scoring model can absorb the judgment term-by-term rather than being replaced wholesale.
- Verifier failure has a sane heuristic fallback.
- Structured LLM output can be validated strictly (known paths, known enums); anything else is unusable.

Do NOT apply when the heuristic already works, latency cannot absorb a bounded model call, or there is no fallback path (fix availability first).

## Examples

**Before — relevance by substring density:**

```ts
const questionWords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
const keywordHits = questionWords.filter((w) => cleanBody.includes(w)).length;
const keywordDensity = questionWords.length > 0 ? keywordHits / questionWords.length : 0;
// Q: "What am I working on right now?" misses a memory saying "current focus: the transitions spine."
```

**After** — same code computes the heuristic baseline, then blends the verdict term.

**Before — ingest wrote AI pages blind:** every `plan.newPages` entry written with `confidence: "high"`, hallucinations included.

**After:**

```ts
const verification = await verifyIngestPlan(proposals, captures);
if (!verification.verified) { plan.unverified = true; return plan; }
const keptNew = plan.newPages.filter((p) => !isInvented(p.path));
plan.crossLinks = plan.crossLinks.filter((l) => surviving.has(l.from) && surviving.has(l.to));
```

## Related

- `docs/solutions/architecture-patterns/decouple-confidence-from-freshness-2026-07-28.md` — the five-dimension confidence separation this layer builds on; its composite formula's relevance term is now the blend point
- arXiv 2408.15240 — Generative Verifiers: Reward Modeling as Next-Token Prediction (the research basis)
- `cli/src/lib/librarian-verifier.ts`, `cli/src/lib/librarian.ts` (applyVerification, weightedScore), `cli/src/lib/ingest.ts` (gateIngestPlan), `cli/src/commands/ask.ts` (evaluateLibrarianEvidence)
- `.opencode/plans/looki-inspired-proactive-memory.md` — proactive attention/tension scoring that could consume these verified signals downstream
