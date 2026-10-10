# Routing learning and recurring assumption audits

Flyd records decision-time routing evidence from both Core chat and the Mac
conversation window. Personal cases, labels and reports stay under
`FLYD_DIR/routing`, never in public replay fixtures.

The existing daily self-improver runs a bounded audit before checking for new
complaints or an improvement awaiting review. It proposes labels for new
development cases, samples apparently successful high-confidence decisions,
and weekly replays reviewed assumptions through the current Jev predicates.
The audit has no execution tools and never dispatches work.

Model labels are proposals. Only explicit reviews become reference labels.
Disagreement on an old reviewed label creates a challenge for review rather
than silently rewriting the label. Reviewed development mistakes and failed
weekly replays feed the existing one-fix-at-a-time improvement pipeline.
The audit never rewrites a live prompt, threshold, model selection or permissions.

## Controls

- `FLYD_ROUTING_LEARNING=0`: disable automatic collection and audit integration.
- `FLYD_ROUTING_JUDGE_MODEL`: exact configured provider/model ID for the
  independent judge (Fable if available). Without it, import and reviewed
  evaluation still work; no default judge is called.
- `FLYD_ROUTING_FALLBACK_MODEL`: optional exact fallback model ID (Luna if
  configured); applies to Core's room reading and the window classifier.
- `FLYD_ROUTING_CASCADE=shadow|live|off`: window ownership cascade. Default
  shadow records a Jev candidate while the existing model chooses the owner.
  Live accepts a confident candidate; uncertain route, owner or need for code
  falls back. Off retains the model classifier without Jev.
- Existing `FLYD_SELF_IMPROVE=0` disables the daily improver and its audits.
  `FLYD_JEV_TURN_ROUTE=0` still disables the production Jev route.

Slash commands and images retain the window's explicit Firstmate path.
Inside Core, answer/clarify/act/delegate and existing tool gates remain the
authoritative turn contract. Unknown/malformed action readings clarify;
classifier failure does not establish authority to act.

## Local workflow

From `cli/`, with the normal project dependencies installed:

```bash
npm run routing -- import
npm run routing -- status
npm run routing -- sample 100
npm run routing -- label 100
npm run routing -- review-queue
npm run routing -- review /absolute/path/reviewed-labels.json
npm run routing -- evaluate observed development
npm run routing -- predict luna validation
npm run routing -- evaluate luna validation
npm run routing -- audit
```

`label` and `predict` require the explicit judge model configuration.
Set it to the model being benchmarked before `predict`. A prediction never
becomes a reviewed label. Review JSON is an array of
`{caseId, expected, reason, reviewer}`; runtime expected labels contain
`route` and optional `domain`, desk labels contain `owner`.

Convenience commands: `flyd improve routing-import`,
`flyd improve routing-audit`, `flyd improve routing-evaluate`.

Session groups determine development/validation/test membership before
labelling. Automatic audits, challenges and improvement evidence see only
development data. Holdout evaluation is explicit. Missing predictions or
unknown ownership remain unscored, with counts shown; cost is unknown until
billing is available. Historical receipts without their original classifier
context are marked incomplete and are not automatically labelled.

Freeze model/prompt/projection versions and choose thresholds on validation
data before explicitly inspecting the test split. Do not enable the live
window cascade based on synthetic tests alone. The existing policy-promotion
and improvement governance owns release decisions; no second learner is added.

## Validation and operating limits

`npm run test:routing-learning` runs the focused native Node suite (Node
22.15+ or 24 recommended); providers are injected and execution is disabled.
It exercises collection, import idempotency, redaction, blind labelling,
review provenance, daily/weekly audits, concurrent locks, holdout isolation,
the real Jev client and the window cascade.

The first run needs George's local receipt history and fresh conversations.
This change does not manufacture 100 samples or claim measured routing accuracy.
Weekly replay currently tests Jev's predicates, not the entire task executor.
Installed CLI/Core must be rebuilt/restarted to use source changes.
