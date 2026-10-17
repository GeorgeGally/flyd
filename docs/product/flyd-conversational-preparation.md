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
