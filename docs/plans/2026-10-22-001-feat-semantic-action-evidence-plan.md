---
title: "feat: grounded action evidence"
type: feat
status: proposed
date: 2026-10-22
---

# Grounded action evidence

## Principle

**Grounding outranks self-report, including for delivery.** A fix is done only
when it is observed live: its PR is merged and the running Flyd/app reports a
build containing that commit. An edit is not done until it is committed and
pushed. A merge or a worker's “done” is not proof that the running product has
the fix.

## Scope

Add a small expectation/observation contract at meaningful action boundaries,
enrich the existing transition spine, and connect the contract to conversation
tool actions. Project into experience traces only if that can reuse the existing
shape without a separate subsystem. Keep normal actions non-blocking; unknown
evidence stays unknown.

Do not add a new store, bus, worker protocol, narration call, or parallel event
taxonomy. Reuse the existing outcome attribution vocabulary (`direct_verified`,
`observed_impact`, `user_rejected`, `not_helpful`, `unknown`) where an
assessment is needed; there is no need for a seventh evidence-kind set.

## Phase 1 — record grounded action evidence

1. Define bounded optional expected-effect and observed-effect fields, using the
   existing transition and semantic-action contracts.
2. Persist them through the existing correlated transition action/next-state
   events; do not create storage or change event kinds.
3. At high-value conversation tool boundaries, attach the expectation declared
   before the action (the turn plan's route and cover points; absent when there
   is no plan) and observations from tool/verifier results. Tool success or a
   worker report without independent evidence cannot mean verified completion.
4. Expose the running Core build commit through `/health`, stamped at Core
   startup from its checkout's HEAD (null when tracked source is dirty). Assess
   delivery as unknown unless the observed running build contains the merged PR
   commit (git ancestry). A merged PR whose commit is absent from that
   build is missed/unknown, never completed.
5. Add focused tests, including an end-to-end merged-PR/stale-running-build
   case. Preserve private payload minimization.

Exit: one correlated conversation action has bounded expectation and grounded
observation; delivery remains unknown until a live build proves the commit.

## Later phase — fresh-action revalidation

Deferred: generalizing repository invalidation and adding target/recipient or
grant revalidation (the former slices 5–6). Do not implement this in phase 1.
Start only when phase-1 evidence demonstrates a consequential stale-assumption
failure and an authoritative, cheap revalidation seam exists.

## Verification

Run the transition, tool-policy, conversation-responder, and relevant
experience tests, plus the delivery end-to-end test; run CLI lint and build.
Delivery itself is verified only after merge and after the running `/health`
build commit includes the PR commit.
