# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Memory

### Librarian

Flyd's memory evidence judge: scores every retrieved memory on independent confidence dimensions and combines them into one ranking score. Cheap formula scoring always runs; an optional generative verification pass can override the relevance judgment when asked to check its work.

### Epistemic Confidence

How likely a claim is to be true, derived from where it came from plus corroboration minus contradiction. Never decays with age — time lives exclusively in Freshness. A stale true fact is not a less true fact.

### Freshness

The sole temporal dimension: how current a memory is relative to its type's half-life. The deliberate counterpart to Epistemic Confidence so old-but-true facts rank lower without becoming dubious.

### Currentness

Whether a memory reflects the *live* present rather than merely being fresh. Requires corroboration by a real-time signal from the Present Model; semantic strength alone never qualifies something as current.

### Present Model

The live snapshot of what is actually happening right now — active task, repository state, recent commits — used to corroborate which memories count as Current.

### Promoted

The boundary between curated knowledge (wiki pages, verified) and source evidence (raw captures, conversation indexes). Unpromoted material stays retrievable but carries lowest authority — it is evidence something was said, not established truth. New AI-generated pages land unpromoted when their verification could not run.
