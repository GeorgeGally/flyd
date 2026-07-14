# PR #5 Review Cleanup Plan

## Goal

Land every still-relevant PR #5 review fix on `main`, preserve the current intelligence-generated surface architecture, and replace framed card/poster renderers with unframed editorial layouts.

## Finding Matrix

| Findings | Status | Execution |
| --- | --- | --- |
| 1, 2, 10, 12, 21, 23 | Confirmed | Fix context lookup, degraded queue behavior, item-level action authorization, correction transactions, root sidebar loading, and generic action scope. |
| 3, 9 | Confirmed | Reapply semantic layout after Turbo morphs and route directed renderers through the shared action renderer. |
| 4 | Already fixed | Existing belief and memory tests stub LLM calls and no longer skip. |
| 5, 11, 13 | Confirmed, judgment required | Serialize decision/composition transitions, remove moved decision evidence from old beliefs, and prevent support-history-only auto-routing. |
| 6, 7, 8, 29 | Confirmed | Add artifact, action, monitoring grammar, and meaningful decision extraction coverage. |
| 14, 15, 16, 17, 18 | Confirmed | Harden broadcast enqueueing, external process timeout, build enqueue rollback, backup retries, and inactive-surface broadcasts. |
| 19, 20 | Confirmed | Bound project memory queries in SQL. |
| 22 | Confirmed | Derive item kinds and renderers from the renderer registry. |
| 24, 25 | Confirmed | Add a forward data migration for legacy generic scenes and scene ownership backfill; do not rewrite deployed migrations. |
| 26 | Superseded | Keep `Surface::Planner` as the compatibility delegate required by `AGENTS.md`. |
| 27 | Confirmed | Make normal RuboCop use the repository's intended array-spacing policy and remove the CI-only exception. |
| 28 | Confirmed | Centralize world-state rebudgeting on the compiled result. |
| 30 | Confirmed | Remove the unused OpenCode build-context compatibility wrapper. |
| Auth/API expansion | Out of scope | Do not invent authentication or broaden the API without a product decision. |

## Execution Order

1. Protect root rendering, context correction, and surface actions with failing controller/service tests.
2. Close validator and missing controller test coverage.
3. Harden jobs, build queueing, backups, broadcasts, and process timeouts.
4. Serialize state transitions and fix correction/routing semantics.
5. Bound queries, centralize registries and rebudgeting, add the forward migration, and clean lint/dead code.
6. Replace card/poster markup and styles with unframed editorial layouts and shared action rendering.
7. Run model, controller, job, service, JavaScript/system, lint, security, migration, and responsive visual verification; commit and push each green slice to `main`.
