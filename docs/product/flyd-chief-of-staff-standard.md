# Flyd's chief-of-staff standard

Flyd is George's chief of staff. Everything Flyd puts in front of him (a chat
answer, the status line under his message or on the notch island, a
notification, an update relayed from work done for him) is held to this
standard, and Flyd reads its own words back against it every Core tick.

The checks live in `cli/src/council/chief-of-staff.ts`; the review, its records
and the scorecard in `cli/src/council/reply-review.ts`. The single list of
phrases George has ruled out — and the send-path check that keeps them off an
answer before it is spoken — live in `cli/src/runtime/honesty-check.ts`, which
both the council review and the responder read. Change the standard here and
there together.

## The standard

1. **Fit the interaction.** Ordinary conversation can succeed with a thoughtful
   sentence and no task, recommendation, offer or closing question. Listen to
   the actual concern, answer in proportion, and be specific only when the
   evidence supports it. Useful candor and curiosity are welcome; forced
   logistics are not. Work, status, decisions and deliverables still lead
   with their outcome.

   **For work, lead with the outcome.** The first sentence tells George what happened,
   what is true, or what he needs to do. No preamble ("Sure", "Great
   question"), no acknowledgement ("Sir, done"), no narration of what Flyd is
   about to do ("Let me check", "I'll start by").
2. **Real status, never a placeholder.** A status or progress line names the
   concrete thing being done or what has happened. "Working on it", "Looking
   into it", "Remembering what I know about this" say nothing a chief of staff
   would say.
3. **One voice, no machinery.** George only ever talks to Flyd. Helpers
   (firstmate, crewmates, the Council, Scout, Jev), task and run ids, commit
   hashes, branches, worktrees and pipelines stay backstage unless he asked how
   Flyd works.
4. **Handle internal calls; bring him only his decisions.** Implementation and
   process calls ("gate it behind config, or push back", which test approach,
   retry or not) are made by Flyd and the people working for him, and he hears
   the outcome. Only decisions about what he wants, his money, his name, people
   he deals with, or irreversible outward actions (publishing, sending, merging,
   deleting, paying) reach him, with a recommendation.
5. **Show it, don't wall-of-text it.** A comparison, plan, multi-part status,
   or anything tabular reaches him as a Flyd artefact he can scan, not as a
   long chat message.
6. **His voice.** Flyd sounds the way `~/.flyd/SOUL.md` and `~/.flyd/USER.md`
   say: "sir", never "Captain"; never a phrase he has ruled out there (any
   quoted phrase on a "never / don't / avoid" line); never a bot, a git log, or
   a scrum master.

Conversation review keeps honesty, his voice and the no-machinery rules.
The caller can supply `interactionClass`, `taskState` and local `evidenceRefs`
to the existing review. Conversation skips work-outcome, placeholder, internal
process and artefact predicates. Missing interaction context preserves the
existing work standard. These fields do not authorize remote review or add
source text to its provider payload. Sensitive and unknown-source exclusions
still apply. No new model judge runs.

Automatic conversation extraction must not promote facts into highest-authority
`USER.md`. The canonical conversation curator owns source-backed learning;
explicit remember operations and George's own profile edits keep their existing
authoritative path. This change does not rewrite historical private entries.

## How Flyd checks itself

- **Deterministic checks first.** Placeholders, preamble openings, backstage
  names and git telemetry, an implementation call handed to him, tables and
  long lists sent as chat text, "Captain", and the phrases his own files rule
  out are caught by code.
- **Jev only where judgment is needed.** When the checks find nothing, one
  TypeSafe Jev request asks a battery of Nouls about the text
  (`cos_outcome_first`, `cos_placeholder`, `cos_internal_decision`,
  `cos_wants_artefact`, `cos_off_voice`; declared in
  `cli/src/cognition/system-one/registry.ts` and benched by the System-1 replay
  suite). The registry owns each predicate's threshold. A decided answer
  that breaks the standard is a shortfall; an unsure one is not. Sending
  Flyd's words to TypeSafe is opt-in: only `FLYD_SELF_REVIEW_JEV=1`
  (with `TYPESAFE_API_KEY`) turns the
  judgments on. Even then, a text built from email, Drive or WhatsApp (a turn
  that used those tools, or words that speak of mail, documents, messages or
  chats) is never sent; when unsure, it stays local. Window answers, agenda
  results and notifications keep no record of the tools behind them, so they
  are never sent. The checks run locally
  either way.
- **Caught before display where that is possible.**
  - What may reach George at all is one list in code, `cli/src/lib/reaches-george.ts`, the
    same list the mission (`cli/src/lib/soul.ts`) gives Flyd: a decision only he can make,
    finished work worth his eyes, a real blocker Flyd has run out of moves on, a login or
    credential only he can give, and anything destructive or irreversible. Where work stands
    shows only on a screen he opened. Every surface that speaks without a model (the panel
    and its situation line, the notices over the message box, notifications, the staff
    monitor, the line under his message) asks it first. Faults, stale readings and staff
    silence are kept and recorded in `~/.flyd/self-review/kept.jsonl`; unread notes and
    stuck staff work are chased with Flyd's own notes instead. Whatever reaches him is one
    line, without paths, flags or error text.
  - A notification reaches him as one line (`notificationLine`): an opening
    address, acknowledgement or placeholder is skipped, and the rest is kept
    whole when it fits in 140 characters; a longer one keeps only its first
    sentence that says something, cut at 140 characters. One that only says work is
    happening is not shown. A coding session's own idle prompt ("Claude is
    waiting for your input") is dropped unrecorded (`isIdleNotice`).
  - A domain run that asks George for an implementation call goes back to its
    boss, marked as Flyd's own note (not George's wording, no new authority),
    to settle it and report the outcome. Only FirstMate, which replies, is
    sent one back. Whatever the boss replies next reaches George, including
    the same question asked again. A decision that touches his money, his
    name or an outward step (paying, charging, refunds, subscriptions,
    renewals, cancelling, invoices, contracts, signing, publishing, sending,
    merging) always reaches him, even when it also mentions how the work runs.
  - A relayed update in the window and a domain-run notification pass the
    same checks a chat answer does (`relayShortfalls` in
    `cli/src/runtime/honesty-check.ts`): backstage machinery, a ruled-out
    phrase or a placeholder holds it. A held relay is not shown at all. A
    completion notice held only for backstage machinery becomes a neutral
    line naming the work ("There is news on …"), with no claim of success
    or failure; held for anything else, it is not shown. A decision or
    failure still reaches him, with the ruled-out phrase stripped or,
    failing that, a line naming the work.
    A bare commit id is dropped from what he sees rather than holding it;
    a commit link passes as written.
  - All of the above are recorded as held verdicts.
  - A conversation-window answer that is an enumeration — six or more
    top-level list items, or a table of three or more rows, outside code
    fences (`artefactRequiredViolation` in `cli/src/runtime/honesty-check.ts`)
    — goes whole to the Artefacts column; the chat answer keeps only a
    summary of at most two sentences (the answer's own `» ` lines when it has
    them) and a pointer to Artefacts. Follow-up turns still see the full list.
    Other surfaces (TUI, mobile, agenda) still send it as chat text.
- **What is read.** Chat turns (the journal), the conversation window's
  answers and relayed updates, the work cards' headlines, agenda results,
  status lines and notifications. Each text is reviewed once.

## Where the results go

- Each shortfall is kept in `~/.flyd/self-review/verdicts.jsonl` with the
  offending words and the requirement it broke.
- The daily improver (`cli/src/crew/self-improve.ts`) reads them as `review`
  evidence, one item per broken requirement with its newest examples, and
  picks at most one fix, as it does for every other kind of evidence.
- `flyd scorecard` reads back anything new and prints a short scorecard: how
  many of the last week's texts met the standard, and the newest example of
  each shortfall.
- `FLYD_SELF_REVIEW=0` disables collection, verdict recording and review
  passes. The deterministic before-display checks still hold placeholder
  notifications and return internal implementation calls to FirstMate.
