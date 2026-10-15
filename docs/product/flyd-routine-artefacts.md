# Routine artefacts

Implemented in the TypeScript conversation view. Open **Preferences → Routines** (or `/routines` on the conversation-view server). A routine is a purpose, editable request template, named inputs and run history. It enters the existing Flyd source router, grants no capability and never sends through a connector directly.

## Discovery and use

Three independent deliveries of the same short request in one conversation suggest a routine. Case and whitespace are ignored. Attachments, replies, slash commands, multiline text, URLs, email addresses and credential-shaped requests are excluded. Only explicit conversation-view submissions are observed, including voice sent through that composer. No background sensing, transcript import or model call is added. Discovery stores hashes and delivery identities until a suggestion exists. A suggestion is an inference about repetition, not evidence of successful outcomes.

A quiet link appears after discovery. Keep or edit the suggested routine; manual creation is also available. Set a useful purpose and parameterize the request with `{{topic}}`, `{{project}}`, etc. The artefact renders input fields and previews the exact expanded request before Run with Flyd. Editing activates a new revision. Stale editors cannot overwrite newer revisions. Dismissed suggestions stay dismissed.

A run fixes its request, revision, substitutions and target conversation before dispatch. Read results in the normal conversation. Submitted means the source returned a delivery receipt, not that work finished or succeeded. Repeated HTTP requests with the same run identifier do not dispatch again. A process death after claiming leaves `dispatching`; a thrown dispatch leaves `unknown`. Neither automatically retries. Check the conversation before initiating another run.

## Persistence and controls

Definitions, hashed observations, activation decisions and submission receipts use validated ContextEnvelopes on the canonical IntelligenceEventStore (`view.routines`). No separate memory authority or learner is introduced. The view opens/closes the store per operation and uses SQLite immediate transactions for cross-process claims. `FLYD_ROUTINES_DB` selects an isolated store for tests/deployments; ordinarily the canonical intelligence database is used.

Pause suggestions stops observation without removing explicitly created artefacts. Forget routine data erases source payloads and pauses discovery. It neither undoes delivered requests nor deletes original conversations. Settling an in-flight run after erasure cannot recreate its payload. `FLYD_ROUTINES=0` disables discovery. Routine text is not sent to a model until an explicit run enters the existing router.

## Boundaries

This is the usable first iteration: editable request artefacts with named inputs, previews and submission history. It does not infer arbitrary click sequences, generate bespoke vendor boards, run on a schedule or automatically modify routines from assistant output. Different wording is not merged. Cross-session semantic discovery and automatic procedure improvements need outcome evidence and the existing governed learning path; delivery alone must not count as success.

Validation covers delivery deduplication, session isolation, activation, stale edits, inputs, restart recovery, uncertain dispatch, erasure, authenticated HTTP routing and HTML-safe executable controls.
