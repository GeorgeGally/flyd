# Contextual dictation and conversation-content learning

Implementation: 3 October 2026; rule-of-three extension: 9 October 2026. Extends the TypeScript cognitive event spine and thin Swift adapter. No Rails dependency or OpenCode requirement.

## Dictation

At the explicit dictation invocation, the adapter captures the original PID, focused AX element and window, a bounded window title, selection and nearby text. Reads have a short AX messaging timeout and run alongside recording. Context is ephemeral. Secure fields, excluded apps and Incognito suppress field context. Privacy settings can disable nearby-text context independently of learning.

Core compiles a bounded spelling shortlist (40 terms), most authoritative first: approved corrections and manual replacements, then distinctive names from subjects conversation learning recorded (newest eight), then relevant names, distinctive terms in the focus, and the current state of a matched project. Learning is read once per utterance through indexed queries, so the prompt and the cleanup see the same state. It does not send full screen context or the entire work history as a transcription prompt.

The target is revalidated before insertion. Switching app, window or focused element sends the result to the clipboard instead. A memory-only “Paste Last Raw Transcript” action recovers the unpolished transcript.

Cleanup preserves words apart from fillers and formatting. Model changes to numbers, negations, paths, flags or other meaningful words are rejected. Spoken self-corrections remain visible when simplifying them cannot be proven faithful.

## Vocabulary learning

Turn on “Learn From My Dictation Edits” in the Flyd menu bar menu (the same switch is in Settings). It is off by default, and Private retention, Incognito and excluded apps suppress capture. The adapter flips Core's `dictation.corrections` source and only shows the switch on once Core confirms, so the menu tick is the source of truth; `flyd learning` points at the menu while the source is off.

Learning starts only after the field value matches the expected insertion at the observed selection range. It follows only that inserted span for up to 30 seconds. Focus drift, unrelated surrounding edits, unsupported AX fields and ambiguous attribution stop observation.

Only a small changed spelling pair and up to two neighbouring words per side are persisted, with the invocation reference, application and a hashed window scope. Full field snapshots and raw audio are not retained. Larger rewrites and protected-slot changes are ignored. The monitor rereads the captured field at its final boundary, so a quick correction is captured and an undo or submission cancels it. Queued evidence is cleared on settings changes; timestamped delayed captures predating the current consent boundary are rejected.

An eligible correction supplies a tentative spelling hint on the next dictation in that window. Three independent sessions with the same pattern, replacement and scope activate a contextual rule automatically. A duplicate or repaste does not count again. Eligibility requires known vocabulary or a distinctive identifier and a plausible spelling match; ordinary homophonic intent changes, numbers/ordinals, dates, units, unknown ambiguous terms and context-free corrections remain ignored or review-only. Exact new names that fail this conservative policy can still be explicitly approved.

Automatically learned replacement rules require both the original window scope and the small neighbouring-word context. They do not apply across every window in an app. Quotes/backticks are excluded from automatic replacement. Repair is deterministic, so it works without a polishing model; model cleanup cannot move or change the spellings deliberately withheld by contextual repair. A finalized correction rides in the next authenticated dictation start before Core takes its vocabulary snapshot, avoiding a race with background HTTP delivery.

Inspect with:

    flyd learning
    flyd learning --approve <sequence>
    flyd learning --reject <sequence>
    flyd learning --pause dictation.corrections
    flyd learning --erase dictation.corrections

`flyd learning` lists tentative/review-only corrections, automatically active rules, approved rules and disabled rules, with evidence counts and recurrence counts (`--json` for detailed evidence and scope). An explicitly approved spelling's term joins every later dictation's spelling hints. Explicitly approved replacements retain their existing application-wide behaviour; narrower automatic rules do not acquire that authority. Within an application, an explicitly approved same-window spelling wins; otherwise conflicting approved spellings are withheld. User-authored manual rules take precedence over learned mappings.

The latest explicit approval/rejection applies to the entire matching rule identity, even when different evidence samples are reviewed. Rejection disables hints and automatic replacements; repetition cannot silently revive it. Explicit reapproval can reactivate it. Erasure revokes the source and removes its payloads. Turning learning back on afterwards starts a new, empty source. Pausing or disabling an erased source is a no-op. Learned words are sent with dictation to the transcription service as spelling hints; this extension does not add an external improvement-model destination.

A repeated correction after automatic promotion retains the original rule identity and increments its recurrence count instead of starting from zero. The review screen flags it for investigation. These reports remain local; this release does not automatically send personal correction fragments to First Mate or the coding crew, nor claim a failure stage without evidence. Promotion may show a quiet “Learned spelling” notice when dictation is idle. Native next-start delivery does not interrupt ongoing recording with a notice.

## Conversation-content learning

Existing Flyd conversation events feed a separate background content pass. It extracts reported decisions, constraints, problems, blockers, dependencies, goals, rejected approaches, facts and unverified outcomes. Lessons remain inferred, source-linked evidence; they do not become global preferences or execution authority.

Use FLYD_CONVERSATION_LEARN_MODEL to select an OpenAI-compatible extraction model. When absent, the configured FLYD_DICTATE_MODEL is reused. Without either, a conservative deterministic extractor handles simple statements. FLYD_CONVERSATION_LEARNING=0 disables the content pass. Model work is bounded. A failed extraction leaves the processing cursor for retry; after three failed attempts that turn falls back to the deterministic extractor so one turn cannot stall the queue.

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

For the 9 October extension, Core tests cover automatic promotion, independent-session counting, contextual repair with polishing off, actual transcription request wiring, next-start ordering, restart, rule-level rejection/reapproval, conflicts, scope isolation, quotes, model bypass regressions, numeric/intent exclusions and delayed-capture consent boundaries. New Swift helper tests cover final-read undo, quick edits, clearing and attribution loss. These new native changes have not been compiled or executed on macOS in the Linux implementation environment; the earlier 149-test result is historical, not validation of this extension.

CI also exposed a pre-existing Scout timezone test failure (reproduced on the preparation commit with TZ=UTC) and dependency audit failures in unchanged dependency files.

No real-user audio corpus was available here. Accuracy and latency improvements are not yet measured. Local baseline extraction is intentionally limited; rich learning requires a configured model. Automatic whole-conversation capture in arbitrary applications requires an attributed integration or intentional import. Unsupported text fields skip edit learning. Existing legacy captures from before source migration are separate historical files.
