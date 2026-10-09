---
module: dictation-learning
date: 2026-10-09
problem_type: architecture-pattern
tags: [voice, corrections, learning, fidelity, privacy]
---

# Evidence-backed voice corrections without blind replacement

## Problem

Existing edit capture retained reviewable correction pairs, but only explicit approval affected voice. Repeated corrections did not accumulate or promote. Automatically applying the old app-wide replacement contract would also rewrite unrelated names, while a memory-only rule would never improve output.

## Solution

Keep correction observations and review events in the canonical cognitive event store. Derive rule identities from normalized pattern/replacement plus app/window scope. Count independent sessions, not notifications. An immediate transaction prevents duplicate session writers from inflating evidence. Projection groups and conflict indexes are built linearly, not with a full cross-scan per observation.

Only known vocabulary or distinctive identifiers with a plausible orthographic/phonetic match are eligible. Phonetics alone cannot distinguish cancel/counsel or numeric homophones; preserve complete number words and ordinals. First eligible correction contributes a scoped hint; the third contributes a contextual replacement. Never pool different error patterns merely because their destination spelling matches.

Automatic rules carry tiny left/right contexts and remain window-scoped. Explicit approval retains its existing stronger app-wide authority. The latest explicit review event governs the whole rule identity; reviewing a different evidence sample cannot leave a supposedly disabled rule active.

Deterministic repair runs before optional model cleanup. For contextual rules, align normalized lexical tokens by position and preserve exact spelling of both source/destination occurrences in subsequent model output. Aggregate counts or neighbouring-word signatures can be bypassed by moving a spelling between repeated phrases. Preserve quote/backtick exclusions too.

At a native observation boundary, reread the captured AX element and validate the attributed span. Do not trust the last debounced snapshot: it loses quick edits and can learn an undone change. Carry the finalized correction in the next authenticated start frame and ingest synchronously before vocabulary retrieval; no extra HTTP wait delays recording. Bound delayed evidence to the current source-consent timestamp and clear queued evidence on settings changes.

Recurrences keep their rule identity and appear locally for investigation. Do not automatically copy personal correction fragments into crew outcomes: those persisted copies would escape source erasure and expand transcription-only consent. External tool-building escalation requires its own source-linked lifecycle.

## Verification

Core regression fixtures cover third-use promotion, hint-only first use, duplicates, scope conflicts, ordinal/intent changes, quoted names, token-position/model bypasses, rejection on a different evidence sample, pause/erase and actual transcription wiring. Swift helper fixtures cover final field reads and undo/clear/attribution loss. Real macOS notification ordering and recording remain device release gates.
