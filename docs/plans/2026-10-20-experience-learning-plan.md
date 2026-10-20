# Flyd Experience Learning Plan

**Status:** Source of truth for post-M1 experience learning work  
**Date:** 20 October 2026  
**Repository:** `GeorgeGally/flyd`  
**Current implementation state:** M1 shipped on `main`  
**Primary principle:** improve Flyd through governed experience evidence without creating a second learner, weakening product autonomy, or allowing uncontrolled self-modification.

---

## 1. Goal

Build a learning architecture in which Flyd improves from real use by turning execution traces and user outcomes into evidence, then using that evidence to diagnose recurring failures, validate better behavior offline, and only later promote proven changes through shadow/canary stages.

The learning spine is:

```text
EXECUTE
  ↓
TRACE
  ↓
TRIAGE
  ↓
DIAGNOSE
  ↓
LOCAL REPAIR HYPOTHESIS
  ↓
REPLAY / EVALUATE
  ↓
GENERALIZE
  ↓
SHADOW
  ↓
CANARY
  ↓
PROMOTE OR REJECT
```

This plan deliberately avoids arbitrary runtime self-rewriting.

---

## 2. Architectural constraints

### 2.1 Reuse Flyd's existing canonical systems

Do not introduce a parallel memory store, a second self-improvement pipeline, a Rails dependency, or another event database.

Use:

- `IntelligenceEventStore` as the canonical durable semantic event spine.
- `TurnReceipt` as detailed per-turn execution evidence.
- existing routing-learning infrastructure for evaluated routing decisions.
- existing correction and self-improvement paths for explicit user feedback.
- existing policy/evaluation infrastructure for governed promotion.

The experience layer is a normalization and evidence layer across these systems.

### 2.2 Active runtime is TypeScript Core

Rails is legacy and must not gain active intelligence responsibilities.

All work in this plan belongs under active TypeScript Core areas such as:

- `cli/src/runtime/`
- `cli/src/intelligence/`
- `cli/src/cognition/`
- `cli/src/transitions/`
- `cli/src/evals/`

### 2.3 No new approval bureaucracy

Flyd should remain optimistic and capable.

A learning failure must not default to:

```text
failure → ask George more often
```

Preferred repair order:

```text
1. do better
2. try a different route
3. recover automatically
4. ask only when necessary
```

Evaluation must therefore penalize unnecessary clarification, confirmation, latency, and friction.

### 2.4 Observation is not truth

One interaction creates evidence, not a durable lesson.

A correction may prove the previous result was wrong without proving the proposed repair is right.

Every durable behavioral change requires evidence beyond the originating example.

### 2.5 Promotion is controlled

Initially, candidate changes may only target controlled surfaces:

- context-selection policy
- routing/decision policy
- recovery policy
- presentation/artefact-selection policy
- existing skill parameters or bounded skill definitions

Do not allow automatic arbitrary source-code mutation.

Code-level improvements continue through the normal coding/review/test/land path.

---

## 3. Canonical learning scopes

Use three scopes for v1.

### EPISODE

Temporary and local to the current task/session.

Examples:

- "In this conversation, 'the deck' means the Nuanu Christmas deck."
- "This particular request explicitly asks for the newest file."

No durable promotion required.

### PERSONAL

Durable behavior specific to George and his workflows.

Examples:

- prefer semantic project identity over recency when choosing among project assets.
- avoid unnecessary confirmation in routine personal workflows.
- prefer a comparison artefact over prose for multi-option decisions when that repeatedly works better.

Workflow/project/domain are selectors on a PERSONAL rule, not separate promotion levels.

### GENERAL

Behavior that improves Flyd independent of George or a specific project.

Examples:

- if a tool returns an authentication-expired failure and a governed refresh path exists, recover through it before asking the user.
- if a semantic action has multiple provider bindings, reason about the semantic action before binding to a provider.

GENERAL promotion has the strongest evidence threshold.

---

## 4. Capability diagnosis taxonomy

Use this seven-part top-level taxonomy:

```text
UNDERSTAND
CONTEXT
REASON
PLAN
EXECUTE
RECOVER
PRESENT
```

### UNDERSTAND

Did Flyd correctly identify what George wanted?

### CONTEXT

Did Flyd construct the right working context?

Subtypes:

```text
SAVE
RETRIEVE
UTILIZE
```

These must remain distinguishable.

Examples:

- the right memory did not exist → SAVE
- the memory existed but was not retrieved → RETRIEVE
- the right memory was retrieved but ignored/misapplied → UTILIZE

### REASON

Did Flyd draw the right conclusion from the available evidence?

### PLAN

Did Flyd choose an effective decomposition/strategy?

### EXECUTE

Did the selected tool/provider/skill actually perform the intended action?

### RECOVER

Did Flyd handle a failure, partial result, stale credential, or uncertain execution correctly?

### PRESENT

Did Flyd communicate or render the result in the right form?

---

## 5. M1 — Observability

**Status: implemented on main.**

### Purpose

Create a compact, versioned, causally-linkable experience record from real Flyd turns without changing runtime behavior.

### Current implementation

Primary files:

- `cli/src/runtime/experience-trace.ts`
- `cli/src/runtime/turn-receipt.ts`
- `cli/src/runtime/turn-repair.ts`
- `cli/src/intelligence/sensors/source-contracts.ts`
- `cli/src/runtime/__tests__/experience-trace.test.ts`

Canonical source ID:

```text
experience.runtime
```

Trace schema:

```text
flyd.experience.v1
```

Storage:

```text
~/.flyd/intelligence.sqlite
```

through the existing `IntelligenceEventStore`.

### M1 trace contents

A compact experience trace records:

- receipt ID
- session ID
- turn number
- timestamp
- user intent
- selected route
- memory verdict
- memory references and authority metadata
- tool names
- tool success/failure
- tool retry count
- outcome status
- answer size
- error metadata where relevant
- model
- provider identity
- routing-policy version
- decision-policy version
- route source
- trace schema version

### Deliberate minimization

The canonical experience trace does **not** duplicate:

- full answer text
- memory excerpts
- raw tool inputs
- raw provider payloads

Those remain in their existing authoritative sources.

### Corrections

Explicit user corrections emit a linked `experience_feedback` event correlated to the originating receipt.

A correction is a learning signal, not an automatically promoted repair.

### M1 done criteria

- trace capture is best-effort and cannot break a successful turn.
- trace writes are idempotent.
- trace data is source-governed and locally retained.
- explicit corrections can be causally linked to the originating trace.
- system policy/model versions are attributable.
- no runtime behavioral change occurs because of trace capture.

---

## 6. M2 — Learning-event triage

### Goal

Identify the small subset of experience traces worth deeper analysis.

Most turns should produce:

```text
NO_LEARNING_EVENT
```

### Jev's role

Jev is the cheap detector, not the final diagnostician.

Input should be compact trace metadata plus bounded relevant outcome context.

Output should be structured and narrow:

```json
{
  "learning_event": true,
  "likely_capability": "CONTEXT",
  "severity": 0.72,
  "confidence": 0.91,
  "reason_code": "explicit_correction"
}
```

### Trigger signals

Candidate learning events include:

- explicit user correction
- tool failure followed by successful alternate route
- repeated tool retry
- repeated instruction by George
- undo/reversal once a real undo signal exists
- manual takeover after Flyd attempted work
- rejected answer
- contradictory context use
- repeated same-class failure
- successful recovery pattern worth reusing
- presentation correction such as "put this in a table"

### Non-signals

Do not infer a learning event merely because:

- the user continued the conversation
- the user did not complain
- the answer was long
- a tool was called
- an LLM judge preferred another wording

### M2 deliverables

- bounded triage classifier
- trace-to-learning-event record
- confidence/severity separation
- reason codes
- replay tests over historical traces
- no live behavior mutation

---

## 7. M3 — Diagnosis and episode construction

### Goal

Turn a triaged learning event into a precise diagnosis tied to one responsible subsystem.

### Model responsibility

Use the stronger reasoning model for diagnosis and repair hypotheses.

Do not let Jev's coarse class automatically determine the repair surface.

### Episode object

Create a normalized episode containing:

- source trace
- relevant preceding/following turns
- selected context references
- tool/action trajectory
- observed outcome
- explicit correction if any
- diagnosed capability
- diagnosed subtype
- candidate scope: EPISODE / PERSONAL / GENERAL
- uncertainty
- competing explanations

### Required diagnostic discipline

A diagnosis must distinguish examples such as:

```text
memory missing
≠ memory not retrieved
≠ memory retrieved but ignored
```

and:

```text
correct plan + failed provider
≠ wrong plan
```

### No repair promotion in M3

M3 may create repair hypotheses only.

It does not activate them.

---

## 8. M4 — Replay and multi-objective evaluation

### Goal

Test whether a candidate repair improves more than the originating example.

### Evaluation corpus

Prefer real historical Flyd traces.

For each candidate evaluate:

1. originating trace
2. similar historical traces
3. clearly different historical traces
4. protected regression cases

Synthetic cases are secondary and should only fill gaps where real history is insufficient.

### Multi-objective score

A candidate should be evaluated on separate dimensions, not a single opaque score:

- task success
- correctness
- correction rate
- tool failure rate
- recovery success
- unnecessary clarification rate
- unnecessary confirmation rate
- latency
- token/model cost
- tool-call count
- user override/manual takeover rate
- presentation fit where measurable

Do not collapse these too early.

### Example rejection

A candidate may improve task success while still being rejected:

```text
task_success        +14%
correction_rate     -18%
tool_failures        -8%
clarification_rate  +65%
latency              +40%
```

Result:

```text
REJECT
```

because it makes Flyd bureaucratic and slower.

### Historical split discipline

Validation sets must be frozen before judging a candidate.

Avoid evaluating on the exact same traces used to invent the repair.

---

## 9. M5 — Governed candidate generation

### Allowed candidate types

Start with:

```text
CONTEXT_POLICY
DECISION_POLICY
RECOVERY_POLICY
PRESENTATION_POLICY
BOUNDED_SKILL
```

### Candidate record

Every candidate should contain:

- originating episode(s)
- target capability
- proposed scope
- exact controlled surface
- proposed change
- expected benefit
- known tradeoff
- evidence set
- validation metrics
- protected regressions
- status
- version
- rollback target

### Promotion lifecycle

Use:

```text
candidate
  ↓
validated
  ↓
shadow
  ↓
canary
  ↓
active
```

or:

```text
candidate
  ↓
rejected
```

### Evidence thresholds

EPISODE changes may be immediate and temporary.

PERSONAL promotion requires repeated or strong cross-episode evidence.

GENERAL promotion requires multiple independent scenarios and protected-regression success.

---

## 10. M6 — Shadow and canary rollout

### Shadow

A validated candidate observes real work and records what it would have done without changing execution.

Example:

```text
LIVE:
retrieve file A

CANDIDATE:
would retrieve file B

actual outcome:
A was correct

candidate confidence decreases
```

Shadow is the default next state after offline validation.

### Canary

Only after sufficient shadow evidence may a candidate affect a bounded subset of eligible tasks.

Canary requirements:

- reversible
- versioned
- clearly attributed
- budgeted
- protected by kill switch
- automatic regression detection
- automatic or one-step rollback

### Active

A policy becomes active only after canary evidence supports the expected gain without protected regressions.

---

## 11. Recovery learning

Recovery is first-class evidence.

When execution fails:

```text
goal
 ↓
state A
 ↓
state B
 ↓
failure
```

Flyd should preserve:

- last valid state
- failure signature
- alternate routes attempted
- final successful recovery if any

Repeated recovery trajectories may later become bounded recovery policies or skills.

Example:

```text
expired auth
→ refresh credential through governed path
→ retry once
→ succeed
```

Do not default to "ask George" when an existing safe recovery path is available.

---

## 12. Skill crystallization

Do not build autonomous skill learning before trace data proves repeated stable trajectories exist.

A repeated successful sequence may later crystallize into a skill when:

- the semantic intent is consistent
- the preconditions are identifiable
- steps are stable
- success criteria are measurable
- recovery paths are known
- replay shows reduced cost/latency or improved success

Example future skill:

```text
resolve_latest_project_document
```

Potential schema:

```text
Skill
  intent
  preconditions
  steps
  tools
  success_criteria
  recovery_paths
  examples
  scope
  version
```

Skill crystallization is downstream of M4/M5, not a prerequisite.

---

## 13. Semantic action layer

Learning should increasingly attach to semantic actions, not provider-specific APIs.

Examples:

```text
message.send
document.find
document.edit
task.create
decision.make
artifact.render
knowledge.lookup
workflow.execute
```

Provider bindings remain separate:

```text
message.send
  → Gmail
  → WhatsApp
  → Slack
  → SMS
```

A learned behavior such as "resolve ambiguous recipient before sending" should belong to `message.send`, not Gmail.

This supports Flyd's app-eater architecture.

---

## 14. Presentation and generative UI learning

Experience learning must include the interface Flyd chooses.

Track:

```text
intent
→ semantic object / artefact choice
→ interaction
→ outcome
```

Example:

```text
4-way decision
→ prose
→ George asks for a table
```

Diagnosis:

```text
PRESENT
```

Candidate:

```text
for comparable alternatives above threshold, prefer comparison artefact
```

The end-state is not widget selection by rule. Flyd should learn what form best communicates the specific thing it understands it is trying to communicate.

---

## 15. Outcome signals

### Strong positive evidence

- deterministic task verification
- user explicitly confirms success
- user keeps/uses/sends generated result unchanged where observable
- downstream action succeeds
- successful recovery produces verified result

### Strong negative evidence

- explicit correction
- explicit rejection
- undo/reversal
- tool failure
- manual takeover where attributable
- user repeats same instruction because Flyd missed it

### Weak/inconclusive evidence

- silence
- conversational continuation
- positive tone without task verification
- model self-judgment alone

Do not promote durable policies from weak evidence alone.

---

## 16. Versioning and attribution

Every trace used for learning must be attributable to the system state that produced it.

Track immutable version references for relevant surfaces such as:

- trace schema
- routing policy
- decision policy
- context policy
- recovery policy
- presentation policy
- skill version
- semantic action schema
- model
- provider

Without attribution, Flyd cannot know which system change caused an improvement or regression.

---

## 17. Privacy and retention

Experience learning inherits the canonical source-contract model.

Requirements:

- source-governed
- locally inspectable
- locally erasable
- no automatic persistence of raw external evidence into personal memory
- no sensitive high-risk source expansion through this plan
- source revocation/erasure must cascade into replay/evaluation eligibility
- traces should reference authoritative records rather than unnecessarily duplicate payloads

---

## 18. Failure modes to actively avoid

### Bureaucratic Flyd

Symptom:

```text
more learning → more confirmations → less autonomy
```

Mitigation:

- protected clarification/confirmation metrics
- repair preference toward better execution and recovery
- reject candidates that increase friction without overwhelming gain

### Self-confirming evaluator

Symptom:

```text
model proposes bad rule
same model says bad rule is good
```

Mitigation:

- external outcome signals first
- historical replay
- frozen holdouts
- deterministic verification where possible
- protected regression metrics
- shadow/canary before activation

### Overfitting to one correction

Mitigation:

- lowest plausible scope first
- cross-episode evidence before durable promotion
- counterexamples from real history
- expiry/demotion when evidence changes

### Competing learners

Mitigation:

- all learning evidence routes into the existing governed self-improvement architecture
- no second policy store or second durable truth
- one canonical experience source on the event spine

### Trace bloat

Mitigation:

- compact normalized traces
- no duplicate full answer/tool payload storage
- references to canonical source records
- retention controls

---

## 19. Success metrics

M1 success:

- trace coverage
- causal linkage
- version attribution
- no runtime regressions
- bounded storage growth

M2/M3 success:

- learning-event precision
- diagnosis precision
- low false-positive rate
- useful repeated failure clusters emerge

M4 success:

- replay can distinguish beneficial from friction-increasing repairs
- protected regressions prevent bureaucratic policy drift

M5/M6 success:

- shadow predictions correlate with real outcomes
- promoted policies measurably reduce corrections/failures
- rollback remains easy
- unnecessary clarification does not rise

Longer-term product success:

- fewer repeated corrections
- fewer repeated instructions
- better recovery
- lower tool failure/retry burden
- better context selection
- faster common workflows
- better artefact/interface choice
- lower reliance on heavyweight models for known patterns

---

## 20. Implementation order

### M1 — Observability

Status: shipped.

### M2 — Learning-event triage

Next implementation milestone.

### M3 — Diagnosis and episode construction

Build only after real M1 traces provide enough examples.

### M4 — Historical replay and multi-objective evaluation

Must exist before durable automatic promotion.

### M5 — Governed candidate generation

Controlled policy surfaces only.

### M6 — Shadow and canary rollout

Required before automatic activation.

### Later

- skill crystallization
- learned recovery trees
- richer presentation learning
- broader semantic-action transfer
- evolution dashboard

---

## 21. Immediate next step

Implement M2 as a narrow extension of the existing governed learning stack:

```text
experience.runtime trace
→ cheap Jev triage
→ learning_event / no_learning_event
→ durable evidence record
```

Do not diagnose deeply, propose a durable policy, or alter live behavior in M2.

The first question M2 must answer well is simply:

> Is this trace worth learning from?

That is the gate for everything downstream.
