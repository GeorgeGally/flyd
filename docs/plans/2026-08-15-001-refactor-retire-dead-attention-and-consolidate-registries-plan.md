---
title: Retire Dead Attention Engine and Consolidate Repo Registries - Plan
type: refactor
date: 2026-08-15
origin: code-review (revised recommendations)
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Retire Dead Attention Engine and Consolidate Repo Registries - Plan

## Goal Capsule

Remove three confirmed-dead code paths (the `attention/` event engine, `work-intelligence/verification.ts`, `runtime-bridge.ts`) and correct AGENTS.md wording that mislabels the actively-built CLI harness as a legacy subsystem. Repo-registry consolidation is deferred: the two registries serve different persistence layers (in-memory conversation snapshot vs SQLite work index) and merging them is behavior-changing work, not dead-code removal.

No new features. No behavior change to the live wiki-stats attention heuristic (`lib/attention.ts`) or the overlay Core (`server.ts` + `work-intelligence/`).

## Problem Frame

The codebase carries dead subsystems that mislead future work in three ways:

1. `cli/src/attention/` is a full event engine (14 files + 7 tests) whose only importer is `commands/attention-engine.ts`, a command that is **not registered** in `index.ts`/`entry.ts`. `server.ts` mounts no `/attention/*` routes. The live heuristic `lib/attention.ts` (wiki-stats via `buildIntelligenceState`) is separate and wired — it is not what this plan removes.
2. Two files are imported only by their own tests: `work-intelligence/verification.ts` (superseded by `runtime/result-verifier.ts`, which is actively used) and `src/runtime-bridge.ts` (the `runtime-bridge` strings in `repository-action.ts`/`flyd-worker-adapter.ts` are `FORBIDDEN_MODULES` array literals, not imports).
3. Two repo registries coexist with divergent behavior: `runtime/repo-registry.ts` (in-memory, depth-3 scan, TTL cache, feeds CLI conversation) vs `work/repository-registry.ts` (SQLite-backed, single-level scan, feeds `flyd repos`/`flyd tasks` and the work-hypothesis engine).
4. `AGENTS.md` labels `cli/src/runtime/` as "older coding-task subsystem; do not confuse with overlay Core" — but `runtime/` holds the actively-developed CLI conversation harness (`agent-session`, `conversation-responder`, `repo-registry`) and execution primitives the overlay's repository-action path depends on (`flyd-worker-*`, `result-verifier`, `worktree-manager`).

## Product Contract

### Fork resolution (blocking decision — decided here, founder-overridable)

The tension: is the CLI coding harness (`runtime/`) the product, or the Mac overlay (`work-intelligence/`)?

**Decision: the Mac overlay is the product; the CLI harness is the active dogfood/development surface sharing the same Core.** Neither `runtime/` nor `work-intelligence/` is "legacy". The Core (`cli/src/server.ts` + `resolve.ts`) serves both surfaces: the Swift adapter on `/manifest`, and `flyd code`/`flyd chat` as the founder's dogfood loop. The new SQLite work index (`cli/src/work/`) is CLI-first but already feeds the overlay's present model via `server.ts` → `readPresentModel`.

Rationale: STRATEGY.md (2026-08-02) states "Mac-native intelligence layer" and "freeze unrelated architecture expansion"; the overlay PRD is the active product authority. But the actual commit stream and uncommitted work are in the CLI harness, which shares `server.ts` as its Core rather than diverging from the overlay. "Legacy" is factually wrong for a directory being edited this week. The correct framing is *surface vs substrate*, not *product vs legacy*.

Consequence for docs: AGENTS.md's `runtime/` label changes from "older coding-task subsystem" to "CLI coding harness + shared execution primitives (active)". No architecture change.

### Requirements

- R1. Delete `cli/src/attention/` and `cli/src/commands/attention-engine.ts`; keep `cli/src/lib/attention.ts` and `cli/src/commands/attention.ts` (`flyd attention`) untouched and passing.
- R2. Delete `cli/src/work-intelligence/verification.ts` and `cli/src/runtime-bridge.ts` and their now-orphaned test files.
- R3. ~~Consolidate repo registry to a single SQLite book of record~~ **Deferred.** The two registries serve different persistence (in-memory `BriefRepo` snapshot for the CLI conversation vs SQLite `ManagedRepository` work index). Consolidation is behavior-changing refactor, out of scope for this cleanup.
- R4. Correct the `cli/src/runtime/` description in `AGENTS.md` (and any PRD prose with the same "older subsystem" claim) to reflect active status; do not change the overlay/Core architecture statement.
- R5. `npm run lint` (tsc) and `npm test` stay green; no surviving import of a deleted file.

### Key Product Decisions

- **Delete over isolate.** Dead code is removed, not commented out or "deprecated". Git history preserves it.
- **SQLite is the book of record** for repository identity/state (per the Work Index E1 contract). The in-memory `runtime/repo-registry.ts` is a read view that must not diverge in discovery roots or identity.
- **Surface/substrate framing** replaces the "legacy" label; this is a docs correction, not an architecture mandate.

## Implementation Units

### U1. Retire the dead attention event engine

**Goal:** Remove `cli/src/attention/` and its sole importer `commands/attention-engine.ts`, leaving the live `lib/attention.ts` heuristic intact.

**Requirements:** R1

**Dependencies:** none

**Files:**
- Delete `cli/src/attention/` (attention-engine, attention-judge, attention-policy-engine, candidate-builder, commitment-extractor, commitment-store, outcome-recorder, server-routes, signal-bus, attention-dispatcher, index, types, config, and `__tests__/`)
- Delete `cli/src/commands/attention-engine.ts`
- Keep (touch only to verify): `cli/src/lib/attention.ts`, `cli/src/commands/attention.ts`

**Approach:** Confirmed single importer (`commands/attention-engine.ts` → `../attention/*`), confirmed unregistered in `index.ts`/`entry.ts`, confirmed no `/attention` routes in `server.ts`. Delete the directory and the wrapper command. `commands/attention.ts` (`runAttention`) imports `../lib/attention.js`, not the event engine, so the `flyd attention` command and the `/manifest` wiki-stats path (`buildIntelligenceState`) are unaffected.

**Test scenarios:**
- `flyd attention` still resolves and reports wiki-stats (import graph: `commands/attention.ts` → `lib/attention.ts`).
- `tsc --noEmit` passes with no unresolved import from a deleted attention module.

**Verification:** `rg 'from ".*attention/(attention-engine|commitment|signal-bus|outcome-recorder)' cli/src` returns nothing; `flyd attention` still runs.

### U2. Delete dead `verification.ts` and `runtime-bridge.ts`

**Goal:** Remove two files whose only importers are their own tests, plus a dead `FORBIDDEN_MODULES` constant in `repository-action.ts`.

**Requirements:** R2

**Dependencies:** U1 (same commit is fine; both are pure deletion)

**Files:**
- Delete `cli/src/work-intelligence/verification.ts`
- Delete `cli/src/__tests__/verification.test.ts`
- Delete `cli/src/runtime-bridge.ts`
- Delete `cli/src/runtime/__tests__/runtime-bridge.test.ts`
- Modify `cli/src/work-intelligence/repository-action.ts` (remove unused `FORBIDDEN_MODULES` const and any now-dead reference)

**Approach:** `verification.ts` is superseded by `runtime/result-verifier.ts` (which `repository-action.ts` already imports and uses). `runtime-bridge.ts` has zero importers except its test; the `"runtime-bridge"` strings in `repository-action.ts:53` and `flyd-worker-adapter.ts:15` are array literals inside a boundary-check list, not module imports. **Decision: keep `FORBIDDEN_MODULES` intact.** The boundary test in `repository-action.test.ts` asserts the string is present in the forbidden list; removing the entry would force a test change for zero functional gain (the guard is a lint-style invariant, harmless when the module no longer exists). Only the dead source files were deleted.

**Test scenarios:**
- `repository-action` boundary check still rejects forbidden-module dependencies (unchanged; the reduced list removal was deliberately not applied).
- `tsc` passes; `rg 'verification.js|runtime-bridge.js' cli/src` finds no remaining production import.

**Verification:** `npm test` green; no import resolves to a deleted file.

### U3. Consolidate repo registries to one SQLite book of record

**Status: DEFERRED (out of confirmed scope).** The confirmed scope keeps both registries: `runtime/repo-registry.ts` is an in-memory `BriefRepo` snapshot rendered into the CLI conversation, while `work/repository-registry.ts` is the SQLite `ManagedRepository` work index. They serve different persistence layers; consolidation is behavior-changing refactor tracked as follow-up, not dead-code removal. Retain as reference for that follow-up.

**Requirements:** R3

**Dependencies:** none (independent of U1/U2)

**Files:**
- Modify `cli/src/work/repository-registry.ts` (expose the cross-repo summary shape needed by the CLI: a snapshot type and formatting equivalent to `BriefRepo`/`crossRepoLine`/`crossRepoContext`)
- Modify `cli/src/runtime/conversation-responder.ts`, `cli/src/runtime/agent-session.ts`, `cli/src/runtime/project-mention.ts`, `cli/src/commands/code.ts` (import from the SQLite registry instead of `./repo-registry.js`)
- Delete `cli/src/runtime/repo-registry.ts` and `cli/src/runtime/__tests__/repo-registry.test.ts` (or re-home the test to `work/`)

**Approach:** The two registries diverge in discovery roots (runtime: depth-3 over `Documents/Dev/Projects/Code`; work: single-level over `Documents/Code/Projects/Developer/src/dev`) and identity. The SQLite registry is the E1-mandated book of record, so it wins. Migrate the CLI consumers to it, adding a summary formatter that maps `ProjectSnapshot` to the `{name, branch, dirty, lastCommitRelative, isForeground}` the conversation prompt renders. Defer the deeper discovery-recursion fix (single-level → shallow recursion) to the Work Index plan; this unit only removes the *duplicate* registry, it does not change discovery behavior. `isForeground` is derivable from the foreground root the conversation already passes.

**Test scenarios:**
- `conversation-responder` builds the cross-repo prompt block from the SQLite registry with at least two registered repos, and output matches the prior `crossRepoContext` shape.
- `commands/code.ts` repo listing renders registered repos without the in-memory registry.
- The deleted `runtime/repo-registry` has no remaining importers (`rg 'repo-registry' cli/src` only hits `work/`).

**Verification:** `npm test` green; `tsc` green; one registry module owns repo discovery.

### U4. Correct the `runtime/` docs label

**Goal:** AGENTS.md (and any PRD prose) stops calling `cli/src/runtime/` a legacy subsystem and describes it as the active CLI harness + shared execution primitives.

**Requirements:** R4

**Dependencies:** none

**Files:**
- Modify `AGENTS.md` (the "Structure" section and the `cli/src/runtime/` line in "Key files" if present)
- Modify any `docs/product/*.md` that repeats the "older coding-task subsystem" claim (verify via `rg`)

**Approach:** Replace "older coding-task subsystem; do not confuse with overlay Core" with wording that preserves the *do not confuse with overlay Core* guard (the runtime is not the intelligence runtime; `server.ts` is) while removing the false "older/legacy" claim. State the fork decision explicitly: overlay = product, CLI = active dogfood surface, both share Core.

**Test scenarios:** `Test expectation: none — documentation-only; verify via `rg` that no "older coding-task subsystem" phrasing remains for `runtime/`.

**Verification:** `rg 'older coding-task subsystem'` returns nothing; AGENTS.md still names `server.ts` as Core and `runtime/` as harness/primitives.

## Scope Boundaries

In scope:
- Deletion of `attention/`, `commands/attention-engine.ts`, `work-intelligence/verification.ts`, `runtime-bridge.ts`, and orphaned tests.
- AGENTS.md wording correction.

### Deferred to Follow-Up Work
- Repo-registry consolidation (U3): unifying the in-memory `BriefRepo` snapshot and the SQLite work index is behavior-changing refactor, deliberately not part of this cleanup.
- Deepening the SQLite registry's discovery to shallow recursion (E1) and persisting `computeFingerprint`/`remote_url` — tracked separately under the Work Index plan.
- Collapsing `lib/present-model.ts` (Postgres) and `work/work-hypothesis/` into the SQLite index — separate, larger refactor.
- Implementing the `event → attention → act` vision the dead engine anticipated — a future build, not resurrection of dead code.

Out of scope:
- Any change to the overlay Core (`server.ts` + `work-intelligence/` resolution pipeline) or the Swift adapter.
- Changes to the live wiki-stats heuristic behavior.
- Rails tree.

## Risks

- **Boundary-test coupling (U2):** `repository-action.test.ts` asserts the `"runtime-bridge"` string sits in a forbidden-module list. Removing `FORBIDDEN_MODULES` without updating that test fails CI. Mitigation: update the test in the same unit.
- **Registry shape mismatch (U3):** `BriefRepo` and `ProjectSnapshot` fields differ; a naive swap drops `lastCommitRelative`. Mitigation: add a formatter rather than forcing consumers onto the raw snapshot.
- **Doc drift (U4):** AGENTS.md is the active reference; an incorrect rewrite misleads future agents more than the current label. Mitigation: keep the "not the intelligence runtime" guard intact.
