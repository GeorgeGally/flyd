# Conversational preparation

Flyd can prepare a checked local draft when a conversational concern falls within a scope George has explicitly agreed. This is the first native delivery of the [conversational initiative plan](flyd-conversational-initiative-and-presence-plan.md): typed conversation and the view's existing push-to-talk composer share it. Existing LIVE realtime sessions retain their current compatibility path; the plan's new shared LIVE answer ownership is not shipped here.

## Using it

In a conversation, say something like **“Keep preparing local follow-up drafts for our Christmas sponsorship work without waiting for another command.”** Flyd records that specific scope for up to 30 days. A concern such as **“The sponsor still hasn't replied”** can then start a useful draft without another instruction. Ordinary chat and one-off requests do not grant standing permission.

The checked material appears below the answer. **Preferences → Local preparation** shows the original permission, why a draft started, the result and a **Stop preparing** control. “Stop preparing the sponsor draft” or “Don't do anything about the sponsor” revokes that scope and prevents late publication. Explicit “just venting” pauses new preparation for that goal; it does not cancel independently accepted work. A new explicit remit can enable preparation again. **Forget preparation data** erases the conversation's preparation source and blocks delayed writes for that erased source.

Only the user's supplied, session-scoped words enter preparation: the permission, current concern and a small selection of recent user turns with source IDs. Assistant words, imported documents, accounts, ambient memory and repository state do not silently enter the worker. Grant scopes stay inspectable rather than being inferred from a project name or mood.

## What it can do

The native Librarian local-preparation mode produces one local draft, independently checks it, and can repair it once. It has no tools. It cannot send messages, create cloud drafts, read accounts, browse, run a shell, edit repositories, schedule reminders or change preferences. A checked draft is not proof that the business objective was achieved.

Canonical ContextEnvelopes retain grant, source and attempt identity in the intelligence event store. Transactional claims deduplicate replay/equivalent deliverables and reserve at most two active attempts. Expired or interrupted work cannot publish. Cancellation/revocation and source erasure are rechecked before provider calls and checked publication. Uncertain acceptance is not retried as a new request.

Each attempt has one configured provider destination, no fallback or hidden evidence enrichment, zero tools, a 120-second cancellation signal and at most four model calls. Input bytes plus reserved output tokens conservatively enforce a shared 12,000-token ceiling across producer, checker and repair. Small Sonnet 5.5 calls use the supported `between_tools` mode to preserve their response allowance; see [Anthropic's thinking configuration](https://platform.claude.com/docs/en/build-with-claude/thinking).

## Operation and verification

`FLYD_INITIATIVE=0` disables conversational implicit launches. Existing explicit tasks continue normally. `FLYD_INITIATIVE_DB` selects an isolated canonical store for tests; normal operation uses the existing intelligence store.

Run Core checks with `cd cli && npm test`, `npm run lint` and `npm run build`. Reproduce the synthetic preparation routing benchmark with `node --import tsx scripts/eval-conversational-initiative.ts`; add `--live` to refresh judgments against the pinned Jev release. No personal examples belong in those fixtures. Uncertain preparation readings use the existing full reader rather than inheriting confidence from the answer route.

Tests cover grant versus concern, exact source spans, independent confidence, bounded fast-reader coverage, transactional replay/capacity, checked content, cancellation/expiry/erasure races, provider pinning and payloads, shared input/output limits, UI ingress and conversation rendering. Future automatically extracted facts no longer write highest-authority USER.md; the existing canonical source-backed conversation learner remains responsible for inferred knowledge. Historical private profile content is preserved.

## Conversational presence

The responder and compatibility LIVE voice share the compact presence instructions. They allow listening and thinking aloud to be complete outcomes, preserve explicit requests and existing tool gates, and avoid fictional personal details from tone examples. `FLYD_CONVERSATIONAL_PRESENCE=0` restores the previous responder voice instructions; it does not restore automatic profile writes or remove provenance protections.

Optional turn understanding travels through existing view asks, CLI journals and turn receipts into self-review. A full room reading can establish personal conversation; a confident answer route alone cannot. When need is unknown, the interaction class stays unset and work-outcome review remains applicable. Known personal conversation needs no work outcome, but vague work-status claims and forbidden voice still fail local checks. Account-derived or unknown-source replies retain their remote-review restrictions.

Curated memory retains its date, source identity and authority on both fast and fallback paths. Perishable entries become possibly stale at seven local calendar days; aging entries at thirty. Undated recent-state observations are not injected as current mood. Retrieved failed outcomes remain labelled failed. Current explicit intent outranks stored preference; no historical private files are rewritten. Both the conversation responder's old automatic profile extractor and the council's automatic `profile_ops` writer are disabled. Explicit `remember` still saves a memory note; model-supplied `about_george` flags no longer edit USER.md. Profile editing, confirmed bootstrap and onboarding remain available.

Quoted or code-contained words cannot provide a preparation span, even if a reader misattributes them. Interruption checks after routing and before dispatch prevent a cancelled conversational turn from creating fresh preparation. Independently accepted work retains its own supervision and stop controls.

## LIVE integration status

This delivery shares voice instructions and corrects planned-operation wording. It does **not** complete P5: compatibility LIVE still has a separate answer owner and session-start context. No new transcript retention, automatic microphone sensing or implicit LIVE preparation is enabled.

The next LIVE implementation must establish a real transcript-retention contract separately from microphone activation, durably admit final provider items before effects, process them in committed audio order, verify the effective session configuration before `ready`, and route answers through Core. Provider audio/tool responses must be suppressed in shared mode; Core-owned TTS must use the adapter's PCM16/24k format, and interruption must clear queued native playback and discard late generations. Planned device operations need actual execution acknowledgements before spoken completion. Failed connection cleanup must stop capture and playback.

Protocol feasibility was checked against the official [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), [VAD](https://developers.openai.com/api/docs/guides/realtime-vad) and [speech output](https://developers.openai.com/api/docs/guides/text-to-speech) documentation on 18 October 2026. Conversation response controls live under `session.audio.input.turn_detection`; transcript completion is a separate event from audio commitment. The exact existing `gpt-realtime-whisper` input-transcription plus conversation VAD combination has not been proven against a live provider. A separate transcription → Core → TTS transport remains the fallback. Synthetic tests cannot establish installed Mac audio behavior or the real-use pilot; neither was available in this Linux checkout.

## Verification record — 18 October 2026

This presence/provenance delivery was integrated against main at `3568521`, which already contained the native local-preparation path. Twenty targeted suites passed (268 tests), including conversation routing, view persistence, self-review, personal tools, source-backed learning, native preparation, provider bounds and compatibility LIVE output. TypeScript checking and the CLI build passed. The recorded synthetic preparation replay completed; it is not a fresh provider or user-quality evaluation.

The complete suite reported 3,300 passed, 18 failed and 48 skipped tests (348 passing files, nine failing, two skipped). Failures were the unavailable PostgreSQL integration service, process-group inspection (`ps` is unavailable in this host), and an artefact test that expects the checkout itself to be outside a scratch directory. These are environment limits, not a clean full-suite pass. No production model calls, connector mutations, private-profile migration, installed-Mac verification or real-use pilot were performed.

Independent read-only review found the second automatic profile writer, missing fast-path dates and an array-callback clipping regression; the fixes have regression coverage. LIVE review established the retention/transport/media requirements above, not completion of P5.
