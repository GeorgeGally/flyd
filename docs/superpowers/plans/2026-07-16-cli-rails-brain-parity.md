# CLI and Rails Brain Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rails use the same live archive, retrieval, health, profile, and capability contract as the Flyd CLI.

**Architecture:** Extract structured brain services from CLI command presentation, expose them through a JSON bridge and the versioned intelligence export, persist targeted retrieval as Rails provider snapshots, and write Rails events back into the shared archive. Keep all provider and composition work in background jobs.

**Tech Stack:** TypeScript, Vitest, Rails 8, Active Job, PostgreSQL, Minitest, QMD.

---

### Task 1: Define and enforce the brain capability contract

**Files:**
- Create: `cli/src/lib/brain-capabilities.ts`
- Create: `cli/src/lib/__tests__/brain-capabilities.test.ts`
- Modify: `cli/src/index.ts`

- [x] Write a failing test that compares the CLI command IDs with the declared capability manifest.
- [x] Run `cd cli && npm test -- brain-capabilities.test.ts` and verify the undeclared contract fails.
- [x] Add the complete manifest with `automatic`, `targeted`, `maintenance`, `interactive`, and `runtime` integration classes.
- [x] Export the manifest through a structured API while keeping Commander as an adapter.
- [x] Re-run the focused test and `npm run lint`.

### Task 2: Build structured brain health and profile state

**Files:**
- Create: `cli/src/lib/capture-quality.ts`
- Create: `cli/src/lib/brain-state.ts`
- Create: `cli/src/lib/__tests__/brain-state.test.ts`
- Modify: `cli/src/export-state.ts`
- Modify: `cli/src/lib/attention.ts`
- Modify: `cli/src/lib/interests.ts`
- Modify: `app/services/intelligence_state/cli_provider.rb`
- Test: `test/services/intelligence_state/cli_provider_test.rb`

- [x] Write failing TypeScript tests for polluted capture exclusion and structured health/profile output.
- [x] Verify the tests fail because no shared quality filter or brain state exists.
- [x] Implement capture quality checks and a structured state containing health, interests, suggestions, review, graph, knowledge, and capabilities.
- [x] Extend schema `1.0` additively and validate the new collections in Rails.
- [x] Write and run the failing Rails provider test, then implement normalization until it passes.
- [x] Run the focused TypeScript and Rails tests.

### Task 3: Expose targeted retrieval through a JSON bridge

**Files:**
- Create: `cli/src/lib/brain-retrieval.ts`
- Create: `cli/src/bridge.ts`
- Create: `cli/src/lib/__tests__/brain-retrieval.test.ts`
- Modify: `cli/src/commands/ask.ts`
- Modify: `cli/src/commands/search.ts`
- Modify: `cli/scripts/postbuild.mjs`

- [x] Write a failing test for structured matches, stable IDs, freshness, librarian scores, and sufficiency.
- [x] Verify the focused test fails.
- [x] Extract retrieval from terminal presentation into `brain-retrieval.ts`.
- [x] Make ask/search consume the shared result without changing their user-facing output.
- [x] Add a JSON-only bridge entrypoint and compile it in the normal build.
- [x] Run focused tests, lint, and build.

### Task 4: Persist targeted CLI retrieval for Rails composition

**Files:**
- Create: `app/services/intelligence_state/cli_bridge.rb`
- Create: `app/services/intelligence_state/cli_query_provider.rb`
- Create: `test/services/intelligence_state/cli_bridge_test.rb`
- Create: `test/services/intelligence_state/cli_query_provider_test.rb`
- Modify: `app/services/intelligence_state/registry.rb`
- Modify: `app/services/flyd/world_state_compiler.rb`
- Modify: `app/services/flyd/evidence_candidates.rb`
- Modify: `app/services/flyd/reference_registry.rb`
- Test: `test/services/flyd/world_state_compiler_test.rb`
- Test: `test/services/flyd/evidence_candidates_test.rb`

- [x] Write failing service tests for safe argument invocation, invalid JSON, timeout, persistence, and stale fallback.
- [x] Implement the bridge and query provider with no shell interpolation.
- [x] Write a failing compiler test proving active intent retrieval enters provider state.
- [x] Add query-aware provider aggregation and stable `memory_match` references.
- [x] Add memory evidence as support for conversation, investigation, and discovery without mechanically selecting the surface.
- [x] Run all affected Rails tests.

### Task 5: Write Rails intelligence events into the shared archive

**Files:**
- Create: `app/services/flyd/capture_writer.rb`
- Create: `app/jobs/export_memory_event_job.rb`
- Create: `test/services/flyd/capture_writer_test.rb`
- Create: `test/jobs/export_memory_event_job_test.rb`
- Modify: `app/jobs/interpret_intent_job.rb`
- Modify: `app/controllers/surface_item_actions_controller.rb`
- Modify: `app/controllers/surface_feedbacks_controller.rb`

- [x] Write failing tests for atomic, deterministic, escaped Markdown capture files.
- [x] Implement the writer against the configured Flyd raw directory.
- [x] Write failing job tests for intent, decision, correction/feedback, and resolution events.
- [x] Enqueue archive writes only after the owning Rails transaction succeeds.
- [x] Verify duplicate retries produce one capture and user content is preserved.
- [x] Run focused Rails tests.

### Task 6: Verify parity end to end

**Files:**
- Modify: `docs/architecture/intelligence-surface-foundation.md`
- Modify: `AGENTS.md`

- [x] Run `cd cli && npm test`.
- [x] Run `cd cli && npm run lint && npm run build`.
- [x] Run `bin/rails test`.
- [x] Run `git diff --check`.
- [x] Invoke the JSON bridge with a real memory question and inspect stable references and sufficiency.
- [x] Compose a Rails world state for the same question and verify it contains those memory references.
- [x] Update architecture documentation and known issues to reflect the shared brain boundary.
