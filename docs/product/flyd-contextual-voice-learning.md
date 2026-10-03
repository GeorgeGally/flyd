# Contextual dictation and conversation-content learning

Implementation: 3 October 2026. Extends the TypeScript cognitive event spine and thin Swift adapter. No Rails dependency or OpenCode requirement.

## Dictation

At the explicit dictation invocation, the adapter captures the original PID, focused AX element and window, a bounded window title, selection and nearby text. Reads have a short AX messaging timeout and run alongside recording. Context is ephemeral. Secure fields, excluded apps and Incognito suppress field context. Privacy settings can disable nearby-text context independently of learning.

Core compiles a bounded spelling shortlist (40 terms), most authoritative first: approved corrections and manual replacements, then distinctive names from subjects conversation learning recorded (newest eight), then relevant names, distinctive terms in the focus, and the current state of a matched project. Learning is read once per utterance through indexed queries, so the prompt and the cleanup see the same state. It does not send full screen context or the entire work history as a transcription prompt.

The target is revalidated before insertion. Switching app, window or focused element sends the result to the clipboard instead. A memory-only “Paste Last Raw Transcript” action recovers the unpolished transcript.

Cleanup preserves words apart from fillers and formatting. Model changes to numbers, negations, paths, flags or other meaningful words are rejected. Spoken self-corrections remain visible when simplifying them cannot be proven faithful.

## Vocabulary learning

Turn on “Learn From My Dictation Edits” in the Flyd menu bar menu (the same switch is in Settings). It is off by default, and Private retention, Incognito and excluded apps suppress capture. The adapter flips Core's `dictation.corrections` source and only shows the switch on once Core confirms, so the menu tick is the source of truth; `flyd learning` points at the menu while the source is off.

Learning starts only after the field value matches the expected insertion at the observed selection range. It follows only that inserted span for up to 30 seconds. Focus drift, unrelated surrounding edits, unsupported AX fields and ambiguous attribution stop observation.

Only a small changed spelling pair is persisted, with the invocation reference, application and a hashed window scope. The surrounding field and raw audio are not retained. Larger rewrites and protected-slot changes are ignored. Candidates do not replace words until reviewed.

Inspect with:

    flyd learning
    flyd learning --approve <sequence>
    flyd learning --reject <sequence>
    flyd learning --pause dictation.corrections
    flyd learning --erase dictation.corrections

`flyd learning` lists corrections waiting for review and approved ones (`--json` for the raw response). An approved spelling's term joins every later dictation's spelling hints. The word replacement itself applies in the application it was learned in, whatever the window title, so a fix learned in a terminal never rewrites the same word in Mail. Within that application a spelling approved in the same window wins; otherwise conflicting approved spellings are withheld. Review and rejection are reversible; erasure revokes the source and removes its payloads. Learned words — approved spellings and conversation-learned subjects — are sent with the dictation to the transcription service as spelling hints.

## Conversation-content learning

Existing Flyd conversation events feed a separate background content pass. It extracts reported decisions, constraints, problems, blockers, dependencies, goals, rejected approaches, facts and unverified outcomes. Lessons remain inferred, source-linked evidence; they do not become global preferences or execution authority.

Use FLYD_CONVERSATION_LEARN_MODEL to select an OpenAI-compatible extraction model. When absent, the configured FLYD_DICTATE_MODEL is reused. Without either, a conservative deterministic extractor handles simple statements. FLYD_CONVERSATION_LEARNING=0 disables the content pass. Model work is bounded and failures preserve the processing cursor for retry.

Every extracted quote must appear in the user's prose. Code blocks, quoted examples, questions, hypothetical decisions and assistant success claims are excluded. Subject identity is scoped to exactly one grounded project or, when ambiguous, to the conversation. Explicit reversals supersede earlier state while retaining the original evidence.

Original attributed user messages are searchable directly from the canonical event store. Assistant replies are labelled as proposals/reports, not verified facts. Project projections and memory retrieval include related learned state and original evidence references.

## Optional external sources

An authenticated, app-independent ingress accepts structured conversation turns. No unlabelled screen or terminal transcript is parsed into invented speaker roles.

    flyd learning --enable conversation.import
    flyd learning --import conversations.json
    flyd learning --process
    flyd learning --export conversation.import
    flyd learning --pause conversation.import
    flyd learning --erase conversation.import

JSON input:

    {"turns":[{"sessionId":"session-1","messageId":"message-1","user":"The upload still fails on large images.","assistant":"I'll investigate.","projectIds":["project:flyd"]}]}

Imports are bounded and idempotent; obvious credentials are redacted before persistence. Unknown or multiple project associations remain unassigned. Imported evidence and derived lessons share one source, so erasure removes both and rebuilds knowledge projections. Pausing imports does not block Flyd's own conversation learning.

HTTP surfaces on authenticated Core:

- GET /learning — source status and candidate corrections.
- POST /learning/source — enable, pause, disable or erase a named source.
- POST /learning/conversations — ingest attributed turns.
- POST /learning/process — process a bounded batch.
- POST /dictation/correction — observed edit with insertion attribution and scope.
- POST /dictation/review — approve or reject a candidate sequence.

The existing OpenCode capture plugin is an optional producer of this same contract. It supplies separate user/assistant text and project IDs only when a unique configured project is linked to that repository. Long captures are labelled truncated. Once explicitly governed, enabled capture uses Core; paused, disabled or revoked capture does not fall back to legacy files/Gist/distillation. Registration alone does not change the legacy plugin.

Other integrations can use the same ingress without changing the learning engine.

## Verification and remaining limits

Core regression tests cover an approved correction changing the next transcription request's prompt and text (and a candidate alone changing nothing), conversation-learned subjects reaching the next request's spelling hints, context bounds and credentials, semantic fidelity, reviewed/scoped corrections, mundane content, attribution, failed-extraction retry, explicit reversals, duplicate imports, ambiguous project scope, independent pause, original-message search and source erasure.

Swift tests cover config migration and inserted-span isolation. The macOS CI build and all 149 native tests passed. A real dictation/edit session is still required before installation and end-to-end accuracy are called verified.

CI also exposed a pre-existing Scout timezone test failure (reproduced on the preparation commit with TZ=UTC) and dependency audit failures in unchanged dependency files.

No real-user audio corpus was available here. Accuracy and latency improvements are not yet measured. Local baseline extraction is intentionally limited; rich learning requires a configured model. Automatic whole-conversation capture in arbitrary applications requires an attributed integration or intentional import. Unsupported text fields skip edit learning. Existing legacy captures from before source migration are separate historical files.
