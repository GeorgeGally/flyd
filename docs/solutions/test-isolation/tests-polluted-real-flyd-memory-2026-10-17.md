---
title: Tests wrote fixture records into George's real intelligence store
date: 2026-10-17
category: test-isolation
module: intelligence
problem_type: test_pollution
component: testing_framework
severity: high
tags:
  - vitest
  - FLYD_DIR
  - intelligence-sqlite
  - prompt-context
  - flyd-ask
---

## Problem

`cli/vitest.setup.ts` pointed about thirty stores at a temp dir but never set `FLYD_DIR`, so
`defaultIntelligenceDbPath()` (and the present, projection and directive stores) resolved to the real
`~/.flyd`. Every `npm test`, including every worker's validation run, appended fixture events
(`gpt-4o-mini`, `who is the head coach`, `project:test-project`) to `intelligence.sqlite`. By 2026-10-17 about 21%
of the store (6,080 of 29,514 events since Oct 10) was fixture traffic and fake beliefs filled the "Active now" and
conflict lines of every full prompt context (~16K tokens for a four-word question).

## Fix

- `vitest.setup.ts` forces `FLYD_DIR` to a throwaway dir. `assertNotRealFlydHome` (`cli/src/lib/test-home-guard.ts`)
  makes the event store and the work index throw if a test run opens anything under the real `~/.flyd`.
  The guard immediately found `work/database.ts` ignoring `FLYD_DIR`; it now follows it.
- `flyd purge-test-records [--dry-run] [--json] [--db path]` removes rows positively identified as test output
  after a WAL-safe backup to `~/.flyd/backups/intelligence-<timestamp>.sqlite`, then rebuilds the knowledge
  projections. Identification: test model ids (`gpt-4o-mini`, `gpt-4.6`), fixture session ids, the test project,
  and fixture prompts (listed in `FIXTURE_INTENTS`, each a literal in the repo's tests) sent from
  three or more sessions within an hour. Beliefs and relations are removed only when their topic is test-derived;
  judgments and System-1 passes only when they point at a removed event. Anything ambiguous is listed under
  "kept, worth a look". Safe to re-run; stop Core first so nothing appends mid-purge.
- The prompt context is bounded (`boundNowProjection`, per-block caps in `context-compiler.ts`): repo state
  not re-observed for 7 days is dropped rather than shown as current, evidence ids and the conflict dump are gone,
  at most three real conflicts reach a prompt.
- `flyd ask` answers through the chat model chain with failover and fails loudly instead of printing the context.
  `hasApiKey` now asks `resolveModelConnection`, and a bare model under
  `FLYD_PROVIDER=commandcode|openrouter` resolves to that provider (same model, no `.env` change).

## Prevention

Any new store that resolves `~/.flyd` itself must read `FLYD_DIR` first, or a test run will fail on the guard.
