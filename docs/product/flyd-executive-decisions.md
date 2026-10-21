# Executive decisions before presentation

Flyd owns the default Conversation session. `flyd view` starts without a FirstMate inbox or a Claude Code transcript. Explicit `--project` and `--session` options retain transcript inspection. Flyd's own turns use the existing responder, context compiler, tools, memory and private staff notes. Council reads the consented view turns from the existing cognition event stream; the view does not write a second journal.

## Decision record

`cli/src/intelligence/executive/firstmate-decision.ts` interprets a bounded staff change with `quickQuery` and declared Jev predicates. `decision-step.ts` applies deterministic policy and records exactly one disposition on the intelligence event store:

- `handle_internally`: request status about existing work under a matching policy grant, send work back to its boss (`HANDLE_IT_YOURSELF`, `RECOVER_IT_YOURSELF` or `RESTATE_FOR_GEORGE`), or retain an independently verified result.
- `ask_george`: preserve the question and its source alternatives, with a recommendation and an answer route.
- `backstage`: retain operational or unclear information without displaying or announcing it.

`ExecutiveDecisionRecord` separates visible results, questions and internal actions. Durable payloads are parsed before use. A material source identity, state, text or evidence-reference change produces a new observation identity. Repeated polls reuse the decision and its resolution.

Every current source question reaches the decision owner before the legacy `isCurrentDecision` filter. Raw `doing` text remains evidence even when the legacy renderer shortens its display copy. Explicit source questions remain answerable when model interpretation fails: Flyd preserves their wording, requests clarification, and provides free-text input. It never invents a binary approval from an either/or question.

Under a matching grant, a staff question that Jev has not confidently routed to George goes back to its boss once with `HANDLE_IT_YOURSELF`. This includes every question when Jev is off. The boss's next ask reaches George. An internal action Jev has not confirmed, and a failed run Flyd cannot act on, go back once with `RECOVER_IT_YOURSELF`. Delivering that note reopens a failed run so the boss's reply is read. A George decision whose wording fails the final output check goes back once with `RESTATE_FOR_GEORGE`. Each note is sent at most once per run, and only these exact notes count as sent; George's own answers do not. If the restated wording still fails, or no boss can be asked to restate it, Flyd asks George itself. It replaces role names and "branch" in the question. If other backstage words remain, it falls back to the summary and drops the alternatives. A domain run settles in one of three ways. George receives a notice. A routine success or a verified result that is not news settles quietly. Anything that still needs George or Flyd is held for Flyd's attention: a failed run, a decision, a requested result that was not delivered, wording the final check held, or a note to its boss that was not verifiably delivered. The run shows in Flyd's held view as "needs attention" until it moves on. These holds are not counted as output shortfalls in the self-review. A domain run that is with its boss stays un-notified until the boss replies. Failed fleet rows stay in Flyd's held view.

## Authority and verification

`STAFF_COORDINATION_POLICY` defines the permitted internal effect. Under `trusted` or `full` autonomy, Flyd can request evidence about a known existing FirstMate task. `ask` autonomy grants no such effect. The fixed message grants no new scope and no outward authority. Neither model output nor Jev confidence creates a grant.

Before delivery, Core claims an internal action in a SQLite transaction. Concurrent observers cannot execute that claim twice. A failed or uncertain delivery remains recorded and does not retry automatically. A delivery receipt proves that the note arrived; it does not prove that the underlying work recovered.

For displayed completion in this slice, the existing GitHub evidence adapter independently checks a referenced pull request. A merged flag and merge commit establish the narrow result, and the displayed summary describes that merge. A completed label, a staff-authored evidence list, an open pull request or an unsupported evidence type does not establish success. A completed Librarian run that George asked for counts as verified once its detailed report exists, and its brief reaches him as an outcome. Other result-verification adapters remain future work.

The Jev routing predicate uses a confidence threshold of 0.8; outcome interruption uses a separate probability threshold of 0.9. The twelve synthetic cases and real pinned-model recordings are in `cli/src/evals/fixtures/system-one/executive-*`. The recorded run has no wrong decided route and no false interruption, but routing abstains on half the cases. This evidence does not establish broad judgment quality or justify lowering thresholds. Existing Jev enablement controls remain in force.

## Presentation and replaced paths

The production artefact feed, optional staff transcript source, incoming tool notices and domain-run notifier consume executive decisions. Routine pauses, cancellations, run identifiers and quoted explanations of an unsafe `Yes` remain backstage. Core-owned questions render as decisions with their original alternatives and a free-text answer control. A question's decision identity survives into the submitted answer; a changed question rejects the old identity.

The island announces an open decision, an independently verified outcome that passes the separate notability judgment, Flyd's own answer to a question George typed, or a failed send of his message. Routine completion does not interrupt. The existing backstage-name and honesty checks remain the last output fence, including a check against personal promises without an executed action.

This production path supersedes:

- regex-based automatic standing-rule `Yes` answers in `AutoAnswers`;
- status-to-card presentation and row-voice narration as the authority for staff news;
- legacy decision-age/choice-parser filtering before Core interpretation;
- the domain notifier's regex implementation-question return rule and raw-status conclusion;
- direct incoming tool notices as island interruptions.

Legacy parser helpers and their tests remain for explicit compatibility consumers. They do not authorize effects in the production decision path. The landed held-up-to-Flyd behavior and chief-of-staff/output checks remain in use. No Rails dependency, new personal source, new scheduler or new outward capability is introduced.
