# Optimistic decisions: first delivery

Implemented 12 October 2026. Source and harness verification are distinct from a live model pilot or Mac rollout.

## Behavior

Flyd pursues George's goals ambitiously while keeping its evidence honest. It challenges a material flaw with a better path, favors reasonable assumptions for established authorized work, and targets research at facts that could change the next move. Familiarity and old preferences cannot silently narrow current ambition. Routine requests retain their existing path; creative requests can require deeper thought without a longer reply.

`cli/src/lib/decision-policy.ts` provides one compact judgment block. Both conversation prompt modes, the Core overlay resolver, the existing room reader, and LIVE session instructions use it. Fallback room readings with `think`/`decide` get additional bounded-experiment guidance. Confident Jev turns keep their fast path and receive the compact version. The conversation window's Flyd answer path uses the same responder.

This adds prompt tokens, not a classifier, provider round trip, retrieval service, scheduler, approval gate, or decision-record write. Changed model behavior may still change total tool calls, rewrite calls, cost, or latency; those require live measurement. Existing route gates, tool visibility, resource budgets, and domain ownership remain authoritative.

## Rollback and provenance

`FLYD_OPTIMISTIC_DECISIONS=0` removes judgment guidance and restores the old fallback room-reader uncertainty wording. Propagate the environment setting to the running Core/view process and restart it; reconnect LIVE sessions because their instructions are assembled at connection time. This does not edit George's SOUL.md or USER.md.

Existing chat receipts gain optional `decisionPolicy: optimistic-decisions.v1`; it records what was supplied, not policy compliance. Routing provenance distinguishes enabled and baseline behavior. There is no new synchronous write. Window turns without receipt identifiers keep their current behavior.

## Evaluation

The existing read-only eval harness now suppresses conversation/transition capture for successful fictional turns. The synthetic decision suites isolate personal stores, QMD cache, work-index database and cwd before importing the responder; skip live memory/repo retrieval; and use a fixed input clock. Full answers, judge reasons, actual model/provider and structured attempted tools remain in results. Results live outside the temporary context sandbox. These are controlled synthetic cases, not a production accuracy measurement. Provider routing can still be nondeterministic; inspect actual inputs and outputs in comparisons.

From `cli/`, with configured provider and judge credentials:

```bash
FLYD_OPTIMISTIC_DECISIONS=0 npm run evals:chat -- --suite decisions --output-dir ~/.flyd/evals/decision-review
FLYD_OPTIMISTIC_DECISIONS=1 npm run evals:chat -- --suite decisions --output-dir ~/.flyd/evals/decision-review
FLYD_OPTIMISTIC_DECISIONS=1 npm run evals:chat -- --suite decisions-heldout --output-dir ~/.flyd/evals/decision-review
```

Keep development and held-out suites separate. Compare both baseline and candidate on the held-out suite after freezing the candidate, using the same configured model/judge. Outcomes, full answers and attempted tools need human inspection where personal intent or creative quality is ambiguous; a judge score is not proof of improvement.

Cases cover routine/creative requests, constructive disagreement, sufficient/missing evidence, unfamiliar suppliers, changed preferences, failed bets, exhausted experiment effort, new discoveries, an actual requested reminder in the simulated harness, and its draft-only counterpart. Real handler tests under both flag values verify one local write proceeds without extra approval while a declined push remains blocked. Planning-only/answer routes retain mutation gates.

## Scope and next gate

This is the reviewed first delivery. Rich DecisionRecord extraction, dependency graphs, automatic experiment chains, and learned ranking weights are deliberately deferred until this behavior demonstrates value in the live pilot. Experiment envelopes are guidance backed by existing task limits, not a new universal enforcement engine. Do not describe those later stages as shipped.

Before claiming live improvement: run paired model evaluations, inspect friction/quality together, rebuild/install through the supported Mac path, and test real creative and routine turns. Do not turn this into a prerequisite large-data project or another always-on subsystem.

## Verification record

150 focused tests and 5 targeted responder tests pass. TypeScript checking and build pass. The broader responder suite has 28 existing failures; comparison against untouched HEAD (29 failures) introduces no new failure names, with one stale domain-handoff fixture corrected. Live provider/judge evaluation and an installed Mac test were unavailable in this workspace and remain pending.


## Main integration verification — 12 October 2026

Rebased the first delivery onto main at 7b8a561, preserving the newer answer-on-room-failure behavior, tool contracts, and LIVE manifest handling. All 212 relevant tests across nine suites pass, including the full conversation-responder suite; upstream changes resolved the previously recorded chat-suite failures. TypeScript checking and build pass. This supersedes the earlier baseline-failure record for the integrated revision. Live model evaluation and installed Mac rollout remain pending.
