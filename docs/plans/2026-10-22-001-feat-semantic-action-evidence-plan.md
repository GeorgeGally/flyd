---
title: "feat: Semantic action evidence and fresh-action revalidation"
type: feat
status: proposed
date: 2026-10-22
---

# Semantic action evidence and fresh-action revalidation

## Summary

Make Flyd understand its own meaningful actions as **purpose → expected effect → observed effect → assessment**, using the runtime, transition, semantic-action and experience-learning systems that already exist.

This plan is deliberately small. It does **not** add a new trace store, event bus, orchestration layer, worker protocol, memory system, Cua dependency, or computer-use abstraction.

The useful lesson from Cua Bots is the narrow seam between agent work and product state: a bot exposes a tiny vocabulary of meaningful progress/needs/outcomes while the harness retains the raw mechanics. Flyd already has the stronger foundations: semantic actions, durable transition evidence, task/runtime evidence, consequence learning and experience traces. The work here is to make those systems converge on grounded semantic action evidence.

The resulting loop is:

```text
goal / intent
  ↓
meaningful action
  ├─ why
  ├─ expected effect
  └─ evidence basis
  ↓
execution
  ↓
grounded observation
  ↓
assessment
  ↓
transition / experience evidence
  ↓
world model + learning + presentation
```

The core rule is:

> Record semantics at meaningful boundaries, not narration for every tool call.

---

## 1. Validation against current Flyd

A fresh review of `main` at `f69fe5e7fdda203ef90b0a59c44c3915e2777ad9` changes the implementation shape substantially from the first idea.

### Already present — do not rebuild

#### Transition spine

`cli/src/transitions/writer.ts` already persists:

- an action with `intent`
- correlation identity
- optional state-before identity
- a next-state with deterministic or ambiguous signal
- optional state-after identity
- structured detail
- causal completeness
- verifier-originated outcomes

This is already the correct durable action → consequence spine.

#### Semantic action representation

`cli/src/runtime/tool-policy.ts` already turns consequential tool calls into semantic Action objects, separates permission policy from presentation, and advances actions through proposed / approved / executing / completed / failed / declined.

Do not introduce a second semantic-action model.

#### Experience observability

`cli/src/runtime/turn-receipt.ts` and `cli/src/runtime/experience-trace.ts` already capture compact tool execution evidence and write canonical `experience.runtime` observations to `IntelligenceEventStore`.

The experience-learning plan explicitly says not to create a second learner or event database.

#### Consequence learning

The transition system already records action → next-state and has deterministic outcome signals, judgments and correction-derived directives.

This plan enriches that evidence. It does not replace consequence learning.

#### Runtime controls

The supervised task runtime already supports stop, retry, redirect and replace. Cua validates those primitives but gives Flyd no reason to add another control layer.

#### Evidence invalidation

The task runtime already detects repository changes that invalidate an assignment base and refuses to blindly continue.

This is the seed for fresh-action revalidation.

### Real gaps

After removing overlap, three gaps remain:

1. **Expected effect is not first-class at the semantic action boundary.**
   Flyd knows what it intends to do, but not consistently what observable change would count as the action working.

2. **Observed effect and assessment are fragmented.**
   Raw tool success, transition next-state, verifier evidence and task completion exist, but there is no small common projection that says what changed and whether that matched the expectation.

3. **Freshness checks are domain-specific.**
   Repository invalidation exists, but the general principle “refresh relevant evidence before a consequential action if its assumptions may have changed” is not yet a reusable runtime primitive.

Those are the only architectural gaps this plan addresses.

---

## 2. Goals

### G1 — Meaningful actions carry purpose and expectation

For consequential or otherwise meaningful actions, Flyd can represent:

```ts
{
  intent: "Verify the mobile navigation fix",
  expectedEffect: "Supported mobile widths have no horizontal overflow"
}
```

The expectation is a falsifiable description of the desired observable effect, not chain-of-thought and not a verbose plan.

### G2 — Outcomes are grounded

After execution, Flyd can associate:

```ts
{
  observedEffect: "All six responsive viewport checks passed",
  assessment: "matched"
}
```

with the same semantic action/correlation.

The observation should come from tool/runtime/verifier evidence where available, not solely from model self-report.

### G3 — Workers and tools project into a tiny semantic vocabulary

Do not force every provider to emit a new protocol. Normalize existing evidence into seven product-level kinds:

```text
progress
observation
change
request
block
artifact
completion
```

This is a **projection vocabulary**, not a replacement for existing event types.

### G4 — Consequential actions revalidate stale assumptions

Before an outward, destructive, irreversible, expensive, or state-sensitive action executes, Flyd can cheaply re-check the evidence that matters to that action.

If the evidence is unchanged, continue without user friction.

If it changed materially, reconsider automatically where possible.

### G5 — Better evidence feeds existing learning

Experience traces and transition evidence gain enough semantic structure for later diagnosis/replay to answer:

- what was Flyd trying to accomplish?
- what did it expect?
- what actually happened?
- did the result match?
- what evidence supports that assessment?

No automatic policy promotion is added here.

---

## 3. Non-goals

Explicitly reject the following:

- no Cua dependency
- no Cua Spaces integration
- no Environment Broker
- no new computer-use layer
- no new `SemanticTrace` database/table
- no new event bus
- no parallel `RuntimeEvent` architecture
- no per-command LLM narration
- no chain-of-thought capture
- no requirement that every read-only tool call produce semantic evidence
- no Rails-owned intelligence logic
- no new approval prompts merely because revalidation exists
- no automatic skill creation or policy promotion
- no replacing `IntelligenceEventStore`
- no replacing existing transition signals or experience traces

Rails may consume/project new fields later for compatibility, but active semantics belong to TypeScript Core.

---

## 4. Design principles

### 4.1 Semantic evidence, not semantic logging

Capture only transitions that matter to understanding the work.

Good:

```text
intent: Verify the fix
expected: mobile view no longer overflows
observed: responsive tests pass at 320/375/430px
assessment: matched
```

Bad:

```text
intent: inspect files
expected: files are listed
observed: ls returned 42 files
assessment: matched
```

unless listing files is itself the user-visible task.

### 4.2 Execution telemetry remains execution telemetry

Tool name, arguments, exit code and provider-specific payloads stay in their current authoritative locations.

Semantic evidence references or summarizes them. It does not duplicate raw payloads into the intelligence store.

### 4.3 Grounding outranks self-report

Evidence priority:

```text
deterministic verifier
  >
structured tool result
  >
observed state change
  >
worker report
  >
model claim
```

A worker saying “done” is not equivalent to verification.

### 4.4 Revalidation should increase autonomy, not bureaucracy

A stale assumption should normally cause:

```text
refresh → adapt → continue
```

not:

```text
refresh → ask George
```

Escalation is reserved for changed evidence that invalidates authority, scope, safety, recipient, irreversible intent, or success criteria.

### 4.5 One canonical semantic shape, many existing sources

Transition records, turn receipts, task runtime events and semantic UI can all project the same small shape without being merged into one storage system.

---

## 5. Canonical semantic action evidence

Add a small shared type in TypeScript Core.

### Proposed location

`cli/src/runtime/semantic-action-evidence.ts`

### Shape

```ts
export type SemanticEvidenceKind =
  | "progress"
  | "observation"
  | "change"
  | "request"
  | "block"
  | "artifact"
  | "completion";

export type SemanticAssessment =
  | "matched"
  | "partial"
  | "missed"
  | "unknown";

export interface ActionExpectation {
  intent: string;
  expectedEffect?: string;
}

export interface ActionObservation {
  kind: SemanticEvidenceKind;
  observedEffect: string;
  assessment?: SemanticAssessment;
  evidenceRefs?: string[];
}
```

Constraints:

- bounded strings
- no raw tool input
- no raw external content
- no hidden reasoning
- evidence refs point to existing authoritative records when available
- `assessment` may remain `unknown`; do not manufacture certainty

This module is a contract/helper only. It owns no persistence.

---

## 6. Workstream A — enrich the existing transition spine

### Goal

Add expected effect and grounded observation to the action → next-state records already used by consequence learning.

### Files

- Modify: `cli/src/transitions/types.ts`
- Modify: `cli/src/transitions/writer.ts`
- Modify/add focused transition tests under `cli/src/transitions/__tests__/`

### Changes

Extend `TransitionActionInput` with optional:

```ts
expectedEffect?: string
semanticAction?: string
```

Extend `TransitionNextStateInput` with optional bounded semantic projection:

```ts
observation?: {
  kind: SemanticEvidenceKind
  observedEffect: string
  assessment?: SemanticAssessment
  evidenceRefs?: string[]
}
```

Persist these inside the existing action/next-state payloads.

Do not change envelope kinds, source contracts, correlation semantics or storage.

### Compatibility

All fields are optional.

Existing callers remain valid.

Older events remain readable.

### Tests

- action persists expected effect without changing existing required fields
- next-state persists grounded observation and assessment
- oversized semantic strings are rejected or bounded at the contract boundary
- raw tool input is not copied
- missing assessment remains unknown/absent rather than inferred
- existing transition tests remain unchanged/green where possible

---

## 7. Workstream B — derive expectations at semantic action boundaries

### Goal

Give meaningful actions an expected effect without asking every tool adapter to invent one.

### Primary files

- Modify: `cli/src/runtime/tool-policy.ts`
- Modify: `cli/src/runtime/conversation-responder.ts`
- Modify: `cli/src/runtime/semantic-action-evidence.ts`
- Tests: `cli/src/runtime/__tests__/tool-policy.test.ts`
- Tests: `cli/src/runtime/__tests__/conversation-responder.test.ts`

### Approach

Extend the existing semantic Action representation only where its schema already permits metadata, or keep expectation adjacent in runtime state if changing the UI semantic schema would create unnecessary coupling.

Create a deterministic helper:

```ts
expectedEffectForToolCall(name, input, context)
```

Use semantic categories rather than provider-specific prose where possible.

Examples:

```text
email_draft
intent: Prepare the requested email
expected: A draft exists for the intended recipient; nothing is sent

edit_file
intent: Apply the requested code change
expected: The target file contains the intended local change

start_coding_task
intent: Delegate implementation
expected: A supervised coding task exists with explicit done-when criteria

whatsapp_send
intent: Send the approved message
expected: The approved message is submitted to the intended recipient
```

For arbitrary `bash`, do not pretend to know the semantic expectation from command syntax alone. Prefer the enclosing task/turn intent and verification criteria. If no useful expectation is available, omit it.

### Important constraint

Do **not** call an LLM just to generate expectation prose for each tool call.

Use existing task/turn semantics first.

---

## 8. Workstream C — observe effects at meaningful boundaries

### Goal

Convert existing execution results into compact grounded observations.

### Primary files

- Modify: `cli/src/runtime/conversation-responder.ts`
- Modify: `cli/src/runtime/turn-receipt.ts`
- Modify: `cli/src/runtime/experience-trace.ts`
- Potentially modify supervised task runtime files only where a verifier already has authoritative evidence
- Tests: existing receipt/experience suites plus focused semantic-evidence tests

### Turn tool calls

Extend `TurnToolCall` only with optional semantic metadata:

```ts
semantic?: {
  intent?: string
  expectedEffect?: string
  observedEffect?: string
  assessment?: SemanticAssessment
  kind?: SemanticEvidenceKind
}
```

Keep raw input in the receipt as today.

The canonical experience trace must continue to omit raw tool inputs.

### Observation derivation

Add deterministic adapters for high-value tool/result classes first:

- file edits/writes
- drafts/doc creation
- delegated task creation
- verifier/test commands
- explicit external sends where delivery result is known
- semantic action lifecycle completion/failure

For generic reads and arbitrary shell commands, record ordinary tool success/failure unless a meaningful effect can be grounded.

### Assessment rules

Examples:

- deterministic verifier passes and expectation is verifier-shaped → `matched`
- verifier fails → `missed`
- tool succeeds but effect cannot be independently established → `unknown`
- some success criteria verified → `partial`
- user explicitly confirms completion → `matched` with user-confirmed evidence
- worker says done with no verifier → never upgrade solely from that claim

---

## 9. Workstream D — project a seven-kind vocabulary

### Goal

Give UI, learning and future workers a common semantic view without replacing existing event taxonomies.

### Proposed helper

`projectSemanticEvidence(source): SemanticActionEvidence[]`

Map existing evidence:

```text
tool started / worker active           → progress
read / verifier / state inspection     → observation
mutation with grounded post-state      → change
approval / missing user input          → request
failure / invalidated assumptions      → block
verified output/file/diff/document     → artifact
verified task/action terminal state    → completion
```

### Critical rule

This vocabulary is a read/projection layer.

Do not rename existing durable events such as:

- `task.completed`
- `worker.completed`
- transition `verified`
- semantic Action lifecycle phases

Those remain authoritative in their domains.

### Consumers

Initial consumers:

1. experience trace
2. transition payload enrichment
3. semantic presentation where useful

Later consumers may include learning triage and dream-cycle analysis.

---

## 10. Workstream E — fresh-action revalidation

### Goal

Generalize the good existing repository-invalidation behavior into a narrow reusable pre-action check.

### Proposed location

`cli/src/runtime/action-revalidation.ts`

### Contract

```ts
interface RevalidationInput {
  actionId: string;
  category: "local" | "outward" | "destructive";
  evidenceRefs: string[];
  capturedState?: Record<string, string>;
}

type RevalidationResult =
  | { status: "fresh"; evidenceRefs: string[] }
  | { status: "changed"; evidenceRefs: string[]; reason: string; canAdapt: boolean }
  | { status: "unavailable"; reason: string };
```

### When to run

Do not revalidate every tool call.

Run when at least one is true:

- outward action
- destructive action
- irreversible action
- recipient/target-sensitive action
- task grant says renewal/revalidation is required
- action depends on a captured state/version/digest
- task has been running long enough that referenced evidence may be stale
- provider explicitly marks evidence stale

Local reversible edits should generally continue without extra work.

### First revalidators

Implement only where Flyd already has cheap authoritative checks:

#### Repository state

Reuse current HEAD/status-digest/base-head evidence.

If repository evidence changed:

- automatically re-read/re-plan if scope remains valid
- escalate only when the change invalidates assignment authority/scope or makes safe continuation ambiguous

#### Target identity

For outward communication, re-check that the resolved target/recipient identity still matches the approved semantic action when such identity exists.

Do not add recipient confirmation prompts by default.

#### Grant/scope

Reuse existing grant expiry/scope checks rather than inventing a second permission mechanism.

### No generic “refresh world state” call

Revalidate the evidence the action actually depends on.

A broad context refresh before every action would be slow, noisy and difficult to reason about.

---

## 11. Workstream F — feed existing experience learning

### Goal

Improve the already-shipped `flyd.experience.v1` evidence without creating `v2` prematurely.

### Files

- Modify: `cli/src/runtime/experience-trace.ts`
- Modify: `cli/src/runtime/__tests__/experience-trace.test.ts`
- Update `docs/plans/2026-10-20-experience-learning-plan.md` only if implementation changes its source-of-truth contract

### Approach

Add bounded optional semantic action summaries to `execution`:

```ts
semanticActions?: Array<{
  kind: SemanticEvidenceKind;
  intent?: string;
  expectedEffect?: string;
  observedEffect?: string;
  assessment?: SemanticAssessment;
}>
```

Retain current minimization:

- no answer body
- no raw tool input
- no memory excerpt
- no raw provider payload

### Schema version decision

Prefer keeping `flyd.experience.v1` if the additions are optional and backwards compatible.

Bump only if existing readers assume an exact shape.

### Learning value

This directly strengthens the existing M2/M3/M4 roadmap:

- triage can distinguish execution failure from expectation mismatch
- diagnosis can see whether the plan was sensible but the provider failed
- replay can compare expected/observed effects
- repeated successful semantic trajectories can later support skill crystallization

No promotion behavior changes in this project.

---

## 12. Workstream G — semantic UI integration

### Goal

Let Flyd communicate meaningful state without exposing tool logs.

### Constraint

The UI should not become an activity console.

Default presentation remains outcome-first.

Use semantic evidence only when it improves the current interface:

- a live task can show one current `progress`
- a block can explain what changed
- a request can expose the actual decision needed
- completion can show verified observed effect
- diagnosis can use expected vs observed evidence when that is the thing being communicated

The current answer-form work already supports Expected / Observed / Cause / Evidence / Next for diagnosis-shaped answers. Reuse that presentation grammar rather than inventing a new trace UI.

No raw command timeline by default.

---

## 13. Implementation sequence

### Slice 1 — shared semantic evidence contract

Implement:

- `semantic-action-evidence.ts`
- bounded validators/helpers
- unit tests

Exit criterion: one tiny reusable type/helper module, no persistence.

### Slice 2 — transition enrichment

Implement optional expectation/observation fields in existing transition inputs and writer.

Exit criterion: action → next-state can carry semantic evidence with identical storage architecture.

### Slice 3 — conversation/tool integration

Attach expectation before meaningful actions and grounded observation after high-value actions.

Start with deterministic tool classes. Do not cover every tool in v1.

Exit criterion: a real conversation turn can produce at least one correlated semantic action with expectation and observation.

### Slice 4 — experience projection

Project semantic evidence into compact experience traces.

Exit criterion: experience trace contains semantics but still excludes raw/private payloads.

### Slice 5 — repository fresh-action revalidation

Extract/generalize current repository invalidation into the narrow revalidation helper and wire it before state-sensitive consequential actions in the supervised runtime.

Exit criterion: changed repo evidence causes re-read/reconsideration rather than stale execution.

### Slice 6 — second revalidator only if justified by existing evidence

Add target identity or grant/scope revalidation based on whichever current path has authoritative identifiers and a clean seam.

Do not create speculative revalidators.

### Slice 7 — end-to-end acceptance

Prove the full loop on one coding task and one non-coding action.

---

## 14. End-to-end acceptance scenarios

### Scenario A — verified coding change

User:

```text
Fix the mobile navigation overflow.
```

Expected evidence:

```text
intent:
Fix mobile navigation overflow

expected:
Supported mobile widths no longer overflow horizontally

action:
edit implementation

observation:
responsive acceptance tests pass at supported widths

assessment:
matched

completion:
verified
```

Assertions:

- no raw shell transcript in semantic UI
- verifier evidence backs the assessment
- experience trace contains bounded semantic evidence
- task completion remains governed by existing verification rules

### Scenario B — repository changes during work

1. worker starts from HEAD A
2. repository changes to HEAD B
3. worker reaches a state-sensitive integration/action boundary

Expected:

```text
revalidate
→ changed
→ refresh relevant repo evidence
→ adapt/re-plan automatically if still within scope
```

No user prompt unless authority/scope/safety is actually invalidated.

### Scenario C — successful tool call with unverified effect

A provider returns success but Flyd has no independent post-state evidence.

Expected:

```text
observed:
provider accepted the operation

assessment:
unknown
```

Not `matched`.

### Scenario D — partial verification

Some success criteria pass and one remains unresolved.

Expected:

```text
assessment:
partial
```

Task must not be promoted to verified completion merely because the worker reports success.

### Scenario E — ordinary read-only conversation

User asks a factual question and Flyd reads two sources.

Expected:

- ordinary tool receipt still exists
- no unnecessary semantic action objects
- no action expectation ceremony
- no UI activity feed

This scenario protects against bureaucracy.

---

## 15. Test plan

### Unit

- semantic evidence validation/bounds
- projection vocabulary mapping
- expectation derivation for supported action classes
- assessment derivation from deterministic evidence
- unknown remains unknown
- revalidation fresh/changed/unavailable states

### Integration

- transition action + next-state correlation
- turn receipt → experience trace semantic projection
- semantic action lifecycle + tool outcome
- repository state change before consequential action
- adaptation path does not add approval when scope remains valid
- grant expiry still uses existing grant enforcement

### Regression

Run existing:

- transition suites
- tool-policy suites
- conversation-responder suites
- turn-receipt suites
- experience-trace suites
- supervised task/runtime integration suites
- repository invalidation/intervention suites
- semantic/conversation-view suites affected by Action rendering

### Privacy regression

Assert canonical intelligence events do not contain:

- raw email/message body unless already explicitly governed by that source
- raw shell command input from receipt
- memory excerpts
- full answer text
- hidden reasoning

---

## 16. Instrumentation and success criteria

Measure whether this makes Flyd better rather than merely more observable.

### Coverage

- percentage of consequential actions with an expectation
- percentage with grounded observation
- percentage with deterministic assessment
- percentage left correctly unknown

### Quality

- false “matched” rate on failed/partial actions
- stale-action prevention count
- automatic adaptation after changed evidence
- unnecessary user escalation rate

### Friction guardrail

The project fails if it materially increases:

- confirmations
- clarification questions
- latency on ordinary read-only turns
- tool calls for low-consequence actions

### Learning usefulness

Sample traces should make these distinctions mechanically possible:

```text
bad intent
vs
bad plan
vs
tool/provider failure
vs
stale evidence
vs
verification failure
vs
successful verified action
```

---

## 17. Rollout

### Phase 1 — record only

Semantic expectation/observation fields are captured but do not alter behavior.

### Phase 2 — experience consumers

Allow existing learning/diagnostic systems to read the new optional fields.

### Phase 3 — repository revalidation behavior

Enable automatic fresh-action revalidation at the already-understood repository boundary.

### Phase 4 — expand only from evidence

Add more action classes/revalidators only where real traces show a recurring blind spot.

No broad “semanticize every tool” project.

---

## 18. Risks and mitigations

### Risk: trace bloat

Mitigation: semantic records are bounded summaries and references; raw data stays authoritative elsewhere.

### Risk: model self-congratulation

Mitigation: assessment derives from deterministic/verifier evidence where possible; worker claims alone cannot produce verified `matched`.

### Risk: duplicated learning systems

Mitigation: all durable semantic evidence rides existing transitions and `IntelligenceEventStore`; no new store.

### Risk: stale-state checks become bureaucracy

Mitigation: revalidate only consequential/state-sensitive actions and auto-adapt by default.

### Risk: vocabulary becomes another event taxonomy

Mitigation: seven kinds are a projection layer only. Existing domain event types remain unchanged.

### Risk: Rails becomes active again

Mitigation: implementation lives in TypeScript Core. Rails receives compatibility projection only if an existing surface requires it.

---

## 19. Files expected to change

Likely:

```text
cli/src/runtime/semantic-action-evidence.ts                 new
cli/src/runtime/action-revalidation.ts                     new, narrow
cli/src/runtime/tool-policy.ts                             modify
cli/src/runtime/conversation-responder.ts                  modify
cli/src/runtime/turn-receipt.ts                            modify
cli/src/runtime/experience-trace.ts                        modify
cli/src/transitions/types.ts                               modify
cli/src/transitions/writer.ts                              modify
cli/src/runtime/__tests__/experience-trace.test.ts         modify
cli/src/runtime/__tests__/turn-receipt.test.ts             modify
cli/src/runtime/__tests__/tool-policy.test.ts              modify
cli/src/runtime/__tests__/conversation-responder.test.ts   modify
cli/src/transitions/__tests__/*                            modify/add
```

Potential, only after tracing the exact supervised-runtime seam:

```text
cli/src/runtime/orchestrator.ts or current equivalent
cli/src/runtime/intervention-policy.ts
related runtime integration tests
```

Do not pre-commit to changing Rails models/controllers.

---

## 20. Definition of done

The work is complete when:

1. Flyd can attach a bounded expected effect to a meaningful action.
2. Flyd can attach a grounded observed effect to the same correlated action.
3. Assessment distinguishes matched / partial / missed / unknown and does not treat tool success as proof.
4. Existing transition storage carries the semantic evidence without a new event system.
5. Existing experience traces expose bounded semantic action evidence without duplicating raw/private payloads.
6. Existing event types can be projected into the seven-kind vocabulary.
7. Repository-sensitive consequential actions revalidate their dependency evidence before acting.
8. Changed evidence adapts automatically where safe and does not create a new confirmation habit.
9. Ordinary read-only turns have effectively no added latency or semantic ceremony.
10. Existing transition, runtime, experience, tool-policy and semantic-view tests remain green.
11. No Rails-owned intelligence path is introduced.
12. No Cua runtime dependency is introduced.

---

## 21. Implementation review gate

Before implementation is considered finished, perform two reviews.

### Code review

Check:

- semantic fields are optional and backward compatible
- no duplicate durable store
- no raw payload leakage
- no new model call per tool action
- no accidental approval expansion
- no broad world-state refresh hot path
- deterministic evidence wins over self-report
- event correlation remains stable and idempotent

### Intent review

Ask:

> Does this make Flyd better at understanding what it is doing, or did we merely make it better at describing what it is doing?

Reject any implementation that primarily creates logs, narration, dashboards or ceremony.

The intended product change is:

> Flyd acts with an explicit expectation, notices what actually happened, and can use the difference to adapt and learn.

That is the useful Cua lesson, implemented in Flyd's existing architecture.
