# Flyd Personal Intelligence PRD

## Status

**Product authority — 2026-08-22**

**Owner:** George Galanakis
**Product:** Flyd
**Primary platform:** macOS
**Document role:** Product authority for Flyd as a personal intelligence. This document supersedes `flyd-work-intelligence-prd.md` for product direction (see the supersession map at the end). The work-intelligence PRD remains the authority for the overlay work loop and remains useful implementation history.

---

## 1. Identity

Flyd is a local-first personal intelligence for one person. It maintains grounded beliefs about the user's world, chooses and evaluates helpful interventions, and improves its behaviour only from verified outcomes.

Full-life personal intelligence is the product — Flyd is for George, not only his work. Chat, voice, and the overlay are interfaces to one shared runtime, not separate intelligences.

Flyd may **observe and reason only within active source consent**. It may **act only through a capability grant that permits the exact effect**. High-impact and irreversible actions remain human-confirmed.

## 2. Canonical intelligence state

### 2.1 The durable unit is an event

The durable unit of intelligence is a provenance-bearing event and its derived world model — not a chat turn, a work session, or an archive record. All new personal-runtime facts are stored as immutable, versioned events carrying source, consent snapshot, retention, provenance, idempotency key, correlation, and causation metadata.

Derived state (entities, beliefs, intentions, commitments, opportunities, interventions, outcomes, policy state) is computed from events by deterministic projections. No projection becomes an independent authority; any projection can be rebuilt by replay.

### 2.2 Epistemic separation

Observed facts, inferred beliefs, user-confirmed intentions, proposed actions, and verified outcomes are separate types with separate storage, prompts, and UI. Inference never masquerades as observation; acceptance or rejection of an intervention is evidence, not proof of success. Direct verification, later observed impact, and unknown outcomes remain distinct.

### 2.3 One envelope, one receipt

Every ingress and egress uses one `ContextEnvelope` and produces either a durable receipt or a recorded decision. There are no side doors: sensor paths, interfaces, executive decisions, and capability effects all validate under the same contract.

## 3. Consent planes: PRESENT and LEARN

### 3.1 PRESENT is preserved exactly

All existing PRESENT privacy invariants hold without semantic change (`mac-adapter/Sources/Privacy/PrivacyInvariants.swift`, invariants 1–11). PRESENT emits no personal event type. Quiet foreground observation stays zero-network and zero-persistence.

### 3.2 LEARN is a separate consent plane

LEARN is an off-by-default sensing mode for personal learning. It is distinct from PRESENT: OS permission does not substitute for consent. Every LEARN source has an explicit contract covering:

- **Source and purpose** — what is captured and why;
- **Retention** — how long raw material and derived values live;
- **Egress** — which fields may reach which model or provider, if any;
- **Controls** — inspect, pause, exclude, revoke, export, erase.

Revocation stops capture immediately. Erasure tombstones raw material, destroys every readable payload/reference domain, recomputes projections and indexes, and leaves only a non-identifying deletion audit record.

### 3.3 Redaction before persistence

Data is redacted and classified before event persistence or model access. Raw payload retention is optional, local by default, and independently erasable.

### 3.4 Source sensitivity

High-sensitivity sources (raw screen text, clipboard, microphone content, communications, location, health, finance) are excluded by default. Each requires its own explicit source contract and cannot be enabled as a side effect of another grant.

## 4. Action authority

Every side effect requires an expiring, scope-bound capability grant plus a verifier contract. Observations and read-only investigation never imply action authority.

A grant carries minimum context, effect scope, target fingerprints, expiry, idempotency, and rollback posture. A stale, revoked, over-broad, replayed, or forged grant fails closed before execution. A partial receipt never counts as verified success.

Model and network egress is governed separately from action: an action grant never implies egress authority. Provider/model responses are untrusted results — they may become typed evidence or proposals after validation, but can never mint authority, change a target, invoke a capability, or render user-facing commands directly.

Autonomous high-impact effects (sending, purchasing, publishing, account changes, legal/medical advice, destructive deletion) are outside this product's identity.

## 5. Executive behaviour

A durable executive cycle forms ranked opportunities and records **why it chose silence, notification, proposal, or permitted action** — every decision carries a concise why-now/why-me trace. Attention budgets, cost budgets, quiet hours, cooldowns, and kill switches are enforced, not aspirational.

Each intervention attaches to its belief/evidence, prediction, alternatives considered, authority used, policy version, execution receipt, and outcome assessment. Every surface shares one review contract: helpful / not helpful / unknown, optional reason, visible provenance.

## 6. Self-improvement as policy promotion

Self-improvement changes only proven policy — never unrestricted source rewriting, never raw memory edits presented as learning.

Candidates (prompts, retrieval, scheduling, ranking, tool routing) promote only after replay against frozen, consented episodes shows their declared improvement **and** no regression on protected safety, privacy, truthfulness, interruption, or cost cases. Insufficient, unknown, or attribution-incomplete outcome data cannot promote a policy. Rollout is staged (shadow → canary → active) with expiry and rollback recorded as events. Promotions, canaries, rollbacks, versions, and expiries are inspectable and reversible.

## 7. Exclusions

- No second runtime and no Rails-backed intelligence path.
- No generic chat shell that bypasses the runtime.
- No quiet widening of PRESENT collection or retention.
- No autonomous high-impact effects (§4).
- No high-sensitivity sensing without an explicit future source contract (§3.4).

## 8. Supersession map

| Area | Authority |
|---|---|
| Personal intelligence direction, LEARN, event runtime, authority ledger, policy promotion | this document |
| Overlay work loop (ground → diagnose → intervene), work sessions, closeouts | `flyd-work-intelligence-prd.md` |
| Overlay interaction model, invocation modes, adapter gotchas | `flyd-overlay-prd.md` |
| External evidence adapters and deep research bounds | `flyd-evidence-engine-prd.md` |

Where documents conflict on personal-intelligence scope, this document wins. The work-intelligence PRD's §14 exclusions continue to apply to the overlay work loop; the specialist roster and skill-capability layer (`docs/solutions/architecture-patterns/skill-capability-layer-for-specialists-2026-08-19.md`) operate within it and inherit this document's consent and authority rules.
