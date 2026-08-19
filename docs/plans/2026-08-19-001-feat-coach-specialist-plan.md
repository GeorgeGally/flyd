---
title: "feat: Coach specialist on the work-intelligence pipeline"
type: feat
status: completed
date: 2026-08-19
completed: 2026-08-19
origin: ce-brainstorm dialogue (2026-08-19) + flyd-work-intelligence-prd.md + flyd-personal-agent-platform-prd.md + STRATEGY.md
product_contract_source: ce-plan
---

# Coach specialist on the work-intelligence pipeline

## Summary

Turn the PA from a generalist into a coordinator of a team of specialized agents, proven with one pilot: a **coach** (wellness + business + life) that checks in, compounds its understanding of the user, adjusts goals, and is barred from generic advice. The coach is implemented as a new specialist persona on the **existing** work-intelligence ground→diagnose→intervene→learn pipeline — not a new agent platform. It reuses the existing outcome journal for per-task retrospective, skillify for corrections-as-confirmed-learning, and the Present Model for current-work grounding. The rest of the specialist roster is deferred until the coach proves the concept.

## Problem Frame

Flyd's PA is less useful than Codex / Claude Code / OpenClaw for real work because the everyday conversation path is a generalist with read-only tools. It can investigate but cannot act, and it does not compound domain expertise. The user's vision: Flyd is the PA, backed by a team of specialized (non-generalist) agents that keep learning their domain and improving — the way a founder works through their PA and a real team. The first specialist must prove the whole concept.

A coach is the sharpest pilot because it is the opposite of a generalist: it must know the user deeply, check in, compound that understanding, and never give generic advice. It also forces the two hard decisions up front: (1) how a specialist accesses user data within the privacy invariants, and (2) how the strategy reconciles "specialist team" with STRATEGY.md's "not a general-purpose autonomous background assistant."

## Requirements

- **R1. Specialist handoff seam.** The PA can defer a task to a named specialist instead of answering as a generalist. The specialist is selected by name/domain, not by a general capability router.
- **R2. Coach persona.** A coach specialist with its own system prompt, evaluation dimensions, and avoidances — the anti-generic-advice rule is structural, not aspirational.
- **R3. Coach compounds.** The coach persists a per-domain memory (the user's goals, patterns, corrections) that survives restarts and grows via per-task retrospective plus user corrections.
- **R4. Check-in loop.** The coach can run a lightweight check-in (mood, focus, priorities, what's drifting) and compound the results into its picture of the user.
- **R5. Privacy boundary.** The coach's data access is permission-gated and visible. It reads existing Flyd signals (invocations, foreground, memory) by default; anything more (browsing habits, "look anywhere") requires explicit per-scope consent and does not violate the zero-network PRESENT invariant.
- **R6. No generic advice.** A structural guarantee that the coach grounds every intervention in actual user data (current work, journal, corrections, check-ins) before it speaks.
- **R7. Strategy reconciliation.** STRATEGY.md is updated so the specialist team is framed as a Phase 3 compounding experiment on the existing pipeline — not a pivot to a general-purpose autonomous background assistant.

## Scope Boundaries

### In scope

- A `coach` specialist persona on the work-intelligence pipeline.
- A specialist-handoff seam in the conversation responder (defer by named specialist).
- Coach persistence: goals + patterns + corrections + retrospective, using the existing outcome journal and skillify confirmation.
- A daily check-in path.
- The privacy permission model for the coach's data access.
- STRATEGY.md update framing the specialist team as a Phase 3 compounding experiment.

### Deferred for later

- The rest of the specialist roster (sponsor-outreach coordinator, research analyst, coding-as-one-specialist, deal chief-of-staff).
- Multi-channel delivery (Telegram, voice) of check-ins.
- "Coach can look anywhere" — deep passive surveillance of browsing/habits.
- Always-on background specialist processes.

### Outside this product's identity

- A general-purpose autonomous background assistant.
- A broad SaaS integration catalogue, marketplace, or skill ecosystem.
- Complex multi-agent hierarchy (the work-intelligence PRD §14.3 exclusion). A small roster of named specialists, not an autonomous agent platform.

### Deferred to Follow-Up Work

- Persisting specialist roster registration as a first-class store (beyond the coach pilot).
- Specialist-to-specialist delegation.
- Measuring whether coach interventions change user outcomes (success-metric instrumentation).

## Key Technical Decisions

### 1. Coach is a new DomainStandard, not a new runtime

The work-intelligence pipeline already routes artifact kind → a `DomainStandard` with `evaluationDimensions`, `focusPrompt`, `avoidances` (`cli/src/work-intelligence/domain-standards.ts`). A coach is implemented as an extension of this model — a specialist persona whose "artifact" is the user's current state (goals, energy, obligations, patterns) rather than a design/writing/code artifact. This reuses the existing ground→diagnose→intervene→learn loop instead of building an agent platform.

Rationale: STRATEGY.md Phase 0 says "freeze unrelated architecture expansion," and the PRD §7 says roles describe value delivered, not separate agents. Extending the existing pipeline keeps the coach a compounding experiment, not an architecture pivot.

### 2. Specialist selection by name/domain, not a capability router

The existing worker router (`cli/src/runtime/worker-router.ts`) routes by `WorkerCapability` (analysis/implementation/review/testing/resume) — all code. The coach does not fit that model. The handoff seam selects a specialist by a stable name (e.g., "coach") and domain, resolved through a small specialist registry, not the coding capability router.

### 3. Learning loop = outcome journal + skillify, not a new memory store

Per-task retrospective and user corrections map onto what already exists:
- Outcome journal (`cli/src/work-intelligence/outcome-journal.ts`) — journal each check-in and retrospective.
- skillify (`cli/src/work-intelligence/skillify/`) — a user correction becomes a `proposed → confirmed → written` skill that feeds future Ground packs, exactly the "learn from corrections" mechanism.

The coach's per-domain memory (goals, patterns) is a small structured store of goal/pattern records, not a second memory ontology.

### 4. Privacy: permission-gated coach data access

Default: the coach reads only existing Flyd signals (invocation history, Present Model current work, outcome journal, wiki skills) — no new capture, no violation of the zero-network PRESENT invariant (#11). Explicit per-scope consent is required for anything beyond that. The daily check-in is a consented, visible data stream. No browsing-habit surveillance in this plan.

### 5. Anti-generic-advice is structural

The coach's prompt + pipeline enforces: no intervention without grounding in actual user data. This mirrors the PRD §20.1 risk ("generic intelligence disguised as personal intelligence") and the `focusPrompt`/`avoidances` pattern that already exists per domain.

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification.

```
PA conversation turn (conversation-responder)
  │  incoming message
  ▼
route: immediate? → memory-ingest? → compound-nl? → todos? → workstream? → speaking-pref?
  │  (existing dispatch chain)
  ▼
specialist handoff: is this message addressed to a named specialist? (e.g. "coach")
  │  yes → SpecialistDispatcher → coach pipeline
  ▼
COACH PIPELINE (reuses work-intelligence loop)
  ground    ← loadDomainStandard(coach) + Present Model current work + journal history
  diagnose  ← evaluate user state against coach evaluationDimensions
  intervene ← ONE high-leverage intervention (never generic)
  act       ← deliver intervention (augment/native, or check-in reply)
  learn     ← journal retrospective; corrections → skillify proposed→confirmed→written
  │
  │  no → existing generalist path (unchanged)
  ▼
general agentLoop (read-only, unchanged)
```

**Specialist registry:** a small map of `name → { domain, prompt, evaluationDimensions, avoidances, memoryScope, dataGrants }`. The coach is the first entry. This is a registry, not a multi-agent hierarchy — selection is by named specialist.

**Coach memory shape (directional):**
```
goals/        { id, statement, status, adjustedAt, source }
patterns/     { id, observation, confidence, epistemicStatus, source }   // correction | inferred | check-in
checkins/     { at, mood, focus, priorities, blockers }                    // via outcome journal
```

---

## Implementation Units

### U1. Specialist registry + handoff seam

**Goal:** The PA conversation path can defer a turn to a named specialist.

**Requirements:** R1

**Dependencies:** None

**Files:**
- `cli/src/runtime/specialist-registry.ts` (new)
- `cli/src/runtime/conversation-responder.ts` (modify — add specialist handoff check before the general agentLoop)
- `cli/src/runtime/__tests__/specialist-registry.test.ts` (new)

**Approach:**
- Define a `Specialist` type: `{ name, domain, kind, dispatcher }`.
- A `registerSpecialist` / `lookupSpecialist(name)` registry.
- In `respondToConversation`, before the general agentLoop, check whether the message names a specialist (e.g., "coach", "hey coach"). If a specialist is registered and the dispatch succeeds, return its reply; otherwise fall through to the generalist path unchanged.
- Only the coach is registered in this plan.

**Test scenarios:**
- Message addressed to "coach" routes to the coach dispatcher and returns its reply.
- Message not addressed to any specialist falls through to the generalist path (existing behavior preserved).
- Unknown specialist name ("coach to the moon") falls through, not a crash.
- Registry with only the coach returns the coach for "coach" and null for any other name.

**Verification:** `cd cli && npm test` green; a "coach" message produces a coach-routed reply, a normal message is unchanged.

---

### U2. Coach persona on the domain-standard model

**Goal:** A coach DomainStandard (evaluation dimensions, focus prompt, avoidances) with the anti-generic rule structural.

**Requirements:** R2, R6

**Dependencies:** U1

**Files:**
- `cli/src/work-intelligence/domain-standards.ts` (modify — add `coach` to `WorkDomain` and `DOMAIN_STANDARDS`)
- `cli/src/work-intelligence/__tests__/domain-standards.test.ts` (extend)
- `cli/src/work-intelligence/ground-pack-wiki.ts` (modify — `isWorkDomain` includes `coach`)

**Approach:**
- Add `'coach'` to the `WorkDomain` union.
- Add a `coach` entry to `DOMAIN_STANDARDS` with dimensions grounded in: goal alignment, energy/pattern awareness, commitment integrity, focus vs drift, evidence of progress, wellbeing-without-prying. Avoidances include the structural no-generic rule ("Do not advise without grounding in the user's actual goals, journal, or check-ins").
- The coach's "artifact" is the user's current state (Present Model + journal + goals), not a file. `selectDomainStandard` gains a path to return the coach standard when a coach task is dispatched (driven by the specialist dispatcher, not by artifact kind).

**Test scenarios:**
- `coach` is a valid `WorkDomain` and has a populated `DOMAIN_STANDARDS` entry.
- Coach `avoidances` includes an anti-generic-advice rule.
- `isWorkDomain('coach')` returns true; existing domains still return true; invalid strings return false.

**Verification:** `cd cli && npm test` green; domain-standards test asserts the coach entry exists and carries the no-generic avoidance.

---

### U3. Coach pipeline: ground + diagnose + intervene from user state

**Goal:** The coach runs the work-intelligence loop against the user's current state and returns one non-generic intervention.

**Requirements:** R2, R6

**Dependencies:** U2

**Files:**
- `cli/src/runtime/coach-specialist.ts` (new — coach dispatcher)
- `cli/src/runtime/__tests__/coach-specialist.test.ts` (new)

**Approach:**
- The coach dispatcher assembles a "user state" context: Present Model current work, outcome journal recent entries, registered goals, and (when present) recent check-ins.
- It builds a ground→diagnose→intervene prompt using the coach DomainStandard: diagnose ONE causal issue in the user's current state, propose ONE high-leverage intervention.
- If there is insufficient grounding (no goals, no journal, no check-ins), the coach must say what it needs rather than give generic advice — this is the structural anti-generic rule.
- Returns a plain-text intervention reply that the PA emits.

**Test scenarios:**
- Coach with goals + journal + check-ins present returns one concrete intervention grounded in that data.
- Coach with zero grounding returns a "what I need to coach you" reply, not generic advice.
- Intervention names a specific goal/pattern/obligation from the provided data (asserts grounding).
- Intervention is a single high-leverage item (not a list).

**Verification:** `cd cli && npm test` green; coach dispatcher test asserts grounded, non-generic output and the insufficient-grounding path.

---

### U4. Coach memory: goals + patterns, persisted

**Goal:** The coach persists goals and learned patterns that survive restarts and carry epistemic status.

**Requirements:** R3

**Dependencies:** U3

**Files:**
- `cli/src/runtime/coach-memory.ts` (new — goal/pattern store)
- `cli/src/runtime/__tests__/coach-memory.test.ts` (new)

**Approach:**
- A small file-backed store (under `~/.flyd/coach/`) for `goals/` and `patterns/`.
- Goals: `{ id, statement, status, adjustedAt, source }` — supports adjusting goals over time (the brainstorm requirement).
- Patterns: `{ id, observation, confidence, epistemicStatus, source }` where `epistemicStatus` distinguishes `correction` | `inferred` | `checkin` | `external` — following the documented epistemic-integrity rule (do not present inferred patterns as confirmed fact).
- Load on read, save on write; no new memory ontology, just a structured specialist store.

**Test scenarios:**
- Persist a goal → reload → goal present (survives restart).
- Adjust a goal → `adjustedAt` updates, prior value not silently destroyed.
- Add a pattern with `epistemicStatus: correction` vs `inferred` → status preserved through read/write.
- Empty store (no files) → returns empty, no error.

**Verification:** `cd cli && npm test` green; coach-memory test asserts persistence, goal adjustment, and epistemic-status preservation.

---

### U5. Check-in loop + journaled retrospective

**Goal:** The coach runs a lightweight check-in, compounds it, and journaled retrospectives feed learning.

**Requirements:** R4, R3

**Dependencies:** U3, U4

**Files:**
- `cli/src/runtime/coach-specialist.ts` (extend — check-in + retrospective handlers)
- `cli/src/work-intelligence/outcome-journal.ts` (extend — add coach event types to ALLOWED_EVENT_TYPES)
- `cli/src/runtime/__tests__/coach-specialist.test.ts` (extend)

**Approach:**
- Check-in: coach asks (or receives) mood/focus/priorities/blockers, writes to the outcome journal with a coach event type, and folds key observations into patterns.
- Retrospective: after a coach interaction, the coach writes a short journal entry (what was offered, what the user did) — the compounding source for future sessions.
- Add coach event types (e.g., `coach_checkin`, `coach_retrospective`) to the outcome journal's allowed set.
- Check-in stays a visible, consented data stream (R5) — no passive surveillance.

**Test scenarios:**
- Check-in writes a journal entry with a coach event type; entry is readable back.
- Check-in with a blocker → a pattern is created/updated (compounding).
- Retrospective after a coach interaction writes a journal entry.
- Unknown/legacy event types still rejected by the journal (regression).

**Verification:** `cd cli && npm test` green; outcome-journal test asserts the new coach event types are allowed and round-trip.

---

### U6. Privacy permission model for the coach

**Goal:** The coach's data access is permission-gated, visible, and does not violate the zero-network PRESENT invariant.

**Requirements:** R5

**Dependencies:** U4

**Files:**
- `cli/src/runtime/coach-grants.ts` (new — per-scope consent)
- `cli/src/runtime/__tests__/coach-grants.test.ts` (new)
- `docs/plans/` — note in plan body (privacy review)

**Approach:**
- Define coach data scopes (e.g., `existing_signals` default-on, `browsing` / `extended` off by default).
- Each scope has an explicit consent grant; grants are stored and visible; revocable.
- `existing_signals` (invocations, Present Model, journal, wiki skills) is the only default grant — it reads data Flyd already holds, with no new capture and no external network (PRESENT invariant #11 intact).
- Anything beyond that (browsing habits, "look anywhere") requires an explicit, visible, revocable grant and is out of scope for this plan.

**Test scenarios:**
- Default grants = existing signals only; browsing/extended off.
- Granting a scope makes it available; revoking it removes access.
- Grant state persists and is visible.
- Existing-signal-only access touches no external network path (asserts no outbound calls).

**Verification:** `cd cli && npm test` green; coach-grants test asserts default-scope, grant/revoke, persistence, and no-external-network behavior.

---

### U7. STRATEGY.md reconciliation

**Goal:** STRATEGY.md frames the specialist team as a Phase 3 compounding experiment on the existing pipeline.

**Requirements:** R7

**Dependencies:** None (parallelizable)

**Files:**
- `STRATEGY.md` (modify)

**Approach:**
- Update the "Not working on" list: replace "general-purpose autonomous background assistant" with a scoped statement that Flyd is not a general-purpose autonomous background platform, but a small roster of named specialists (starting with the coach) operates as a Phase 3 compounding experiment on the existing work-intelligence loop.
- Note the specialist team in the approach/tracks as Phase 3 compounding.

**Test scenarios:**
- Manual review: STRATEGY.md no longer flatly forbids the specialist-team concept, and frames it as a bounded Phase 3 experiment, not an agent platform.

**Verification:** Re-read STRATEGY.md; the specialist team is framed as a compounding experiment, not an architecture pivot, and the general-purpose-background-assistant exclusion is preserved with a scoped exception.

---

## System-Wide Impact

- **Conversation path:** a new handoff branch before the general agentLoop; generalist path unchanged when no specialist is named.
- **Domain model:** `WorkDomain` gains `coach`; existing domains and wiki parsing must not regress (`isWorkDomain` extended).
- **Outcome journal:** new coach event types added to the allowed set; existing event types untouched.
- **Privacy:** a new consent layer for coach data scopes; existing PRESENT/invoked/LIVE invariants unchanged. The coach's default scope reads only existing Flyd-held data.
- **Strategy:** STRATEGY.md updated to permit the specialist team as a bounded Phase 3 compounding experiment.

## Dependencies / Assumptions

- Assumes the existing work-intelligence pipeline (ground-pack, domain-standards, outcome-journal, skillify) is the right substrate and is currently green (verified: `cd cli && npm test` passes, 1302 tests).
- Assumes the coach's default data scope (existing Flyd signals) is sufficient to prove the concept without new capture or network access.
- Assumes a "check-in" as a visible, consented message stream is acceptable; no passive surveillance.

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| "Generic intelligence disguised as personal intelligence" (PRD §20.1) | High | High | Structural anti-generic rule (U2 avoidances, U3 insufficient-grounding path) — coach refuses to advise without real grounding. |
| Specialist team drifts toward an agent platform | Medium | High | Scope to ONE named specialist (coach); registry is a map, not a hierarchy; STRATEGY.md frames it as a bounded experiment. |
| Coach memory misrepresents inference as fact | Medium | Medium | Epistemic-status field on patterns (U4) per documented integrity rule. |
| Privacy invariant violation from new data access | Medium | High | Default scope reads only existing signals (U6); no external network; consent explicit and revocable. |
| Check-in becomes prying / user drops it | Medium | Low | Check-in is short, visible, consented; coach asks permission and compresses repeated state (per brainstorm "stay silent or compress it"). |

## Deferred to Follow-Up Work

- The rest of the specialist roster (outreach, research, deal chief-of-staff, coding-as-one-specialist).
- Multi-channel check-in delivery (Telegram, voice).
- Deep passive coach data access (browsing/habits).
- Specialist-to-specialist delegation.
- Measuring whether coach interventions change user outcomes.
