# Surface Action Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every surface action executes the exact semantics Flyd persisted and that decision and action scenes never overstate Flyd's judgment or readiness.

**Architecture:** Resolve actions from `SurfaceItem#actions` at the controller boundary, using only a decision option ID as a selector. Extend `Flyd::SurfacePlanValidator` with strict renderer-specific contracts, then make deterministic renderers depend on validated recommendation and readiness semantics.

**Tech Stack:** Rails 8, Active Record JSON attributes, ERB, Hotwire forms, Minitest system and integration tests.

---

### Task 1: Bind execution to persisted actions

**Files:**
- Modify: `app/models/surface_item.rb`
- Modify: `app/controllers/surface_item_actions_controller.rb`
- Test: `test/controllers/surface_item_actions_controller_test.rb`

- [x] Add controller tests that submit altered labels, questions, and build instructions.
- [x] Run the controller tests and confirm the altered request content is currently used.
- [x] Add `SurfaceItem#offered_action` to resolve a persisted action, with `option_id` selecting among `choose` actions.
- [x] Pass the resolved persisted action into decision, investigation, and build handlers and remove executable request-payload reads.
- [x] Run the controller tests and confirm persisted action content wins.

### Task 2: Enforce strict surface grammars

**Files:**
- Modify: `app/services/flyd/surface_plan_validator.rb`
- Modify: `app/services/flyd/intelligence.rb`
- Test: `test/services/flyd/surface_plan_validator_test.rb`

- [x] Add validator tests for duplicate option IDs, missing or duplicate option actions, mismatched option labels, mismatched investigation questions, and readiness-dependent build actions.
- [x] Run the validator tests and confirm each new case fails for the intended reason.
- [x] Validate one-to-one decision mappings and exact investigation payload equality.
- [x] Require one exact build action only for `ready`; reject build actions for `blocked` and `running`.
- [x] Update the intelligence grammar prompt to describe these contracts.
- [x] Run validator tests and confirm all contracts pass.

### Task 3: Render honest recommendation and readiness states

**Files:**
- Modify: `app/views/surfaces/renderers/_decision_scene.html.erb`
- Modify: `app/views/surfaces/renderers/_action_scene.html.erb`
- Test: `test/system/directed_surface_modes_test.rb`

- [x] Add system tests showing recommendation-free decisions have no `Recommended` or `Accept` controls and blocked/running actions expose no review control.
- [x] Run the directed-surface system tests and confirm the new assertions fail.
- [x] Gate first-option recommendation treatment on recommendation presence.
- [x] Render readiness-specific labels, controls, and boundary copy.
- [x] Run the directed-surface system tests and confirm the journeys pass.

### Task 4: Verify the integrated contract

**Files:**
- Verify: all modified files

- [x] Run controller, validator, and directed-surface tests together.
- [x] Run `bin/rails test` and distinguish any pre-existing failures from regressions.
- [x] Run `git diff --check` and inspect the final diff against the PRD.
- [x] Verify decision, investigation, and action states through the browser-driven system suite at desktop and narrow container widths.
