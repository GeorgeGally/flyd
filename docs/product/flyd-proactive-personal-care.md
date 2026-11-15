# Flyd — Proactive Personal Care

**Status:** Implemented in the existing background agenda tick and Conversation activity column. No new agent, data store, scheduler or notification transport.

## What Flyd does

1. **Creative anticipation.** The 5-minute agenda tick compares today's already-curated Scout edition against active creative/design projects from the Librarian's project index. The interactive Flyd conversation view also checks design-related user turns and can prepare a relevant ambient card for the current direction. Both paths take at most three sourced HTTPS references, require at least two meaningful matches, deduplicate per day, and produce no spoken interruption. Neither runs a fresh search or uploads the user's design context to a provider.
2. **Relationship preparation.** For an upcoming Calendar event in the next 90 minutes, Flyd may surface verified, reasonably fresh `People` memory beside the meeting, including a confirmation date. It matches a unique, exact full name or an unambiguous first name. Ambiguous identities, missing facts, stale memories and irrelevant events stay silent. It never infers someone's children's names or birthdays.
3. **Personal stewardship.** When the Librarian has a fresh, explicitly dated `Commitments` entry due today or within the next two days, Flyd shows one quiet activity note. Vague commitments, guessed due dates and stale notes are ignored. Nothing is automatically sent, booked, purchased or scheduled.

These are **ambient activity records**, not interruptions. Flyd never narrates that a team or model prepared them. The existing activity reader and Story media presentation are responsible for displaying them. Cards expire automatically when the meeting begins, the curated day ends, or the commitment's due day passes, rather than cluttering the activity view for a week.

## Consent and controls

- Creative references reuse local project context and public Scout references, without new model calls or egress.
- Commitment cards reuse already-consented local curated memory. There is no new account or OS sensor.
- Calendar preparation is disabled by default. The user must explicitly run `flyd care enable` to enable the `calendar.meeting-prep` source contract, separate from time-only `calendar.metadata`; macOS Calendar permission is separately required. The reader accesses event UID, title and start time only—not attendees, notes, location, description or email.
- The Calendar reader runs only on macOS when Calendar is already running; it does not open the application in the background. This is a documented v1 limitation, not a guarantee of live coverage.
- `flyd care status` shows consent and feature state. `flyd care run` triggers a local sweep. `flyd care pause` or `flyd care disable` stops calendar preparation. The source contract can be revoked through the existing source-consent registry; revoked sources fail closed.
- `FLYD_PROACTIVE_CARE=0` disables all three slices; `FLYD_PERSONAL_BRIEFING=0` separately disables Calendar preparation even when consented.
- No notification API is called. Activity records contain only the short surfaced facts and source story links, in the existing private local activity store.

## Data / implementation

| Concern | Reused code |
| --- | --- |
| Background trigger | `cli/src/runtime/agenda-tick.ts` |
| Interactive design turns | `cli/src/commands/view.ts` → `runtime/proactive-care.ts` |
| Creative candidates | `council/projects.ts`, `council/scout.ts`, `council/inspiration.ts` |
| Personal evidence | `council/memory-store.ts` |
| Calendar consent | `intelligence/sensors/source-contracts.ts` |
| Calendar metadata | `runtime/proactive-calendar.ts`, `runtime/personal-tools.ts` app-running check |
| Ambient presentation & dedupe | `conversation-view/activity.ts`, existing `records.jsonl` |
| UI | Existing Conversation activity cards + sourced Story media |
| CLI opt-in | `cli/src/commands/care.ts`, `cli/src/index.ts` |

## Tested failure cases

- No source consent or disabled Calendar mode means no Calendar read.
- Revoked Calendar meeting-prep consent fails closed; time-only calendar metadata permission and general macOS permission are insufficient.
- Two people with the same first name are not conflated; stale/ambiguous memories remain silent.
- Calendar metadata is parsed with duplicate and malformed-event rejection.
- Creative cards require at least two distinct, relevant HTTPS story links; unrelated or old editions are ignored.
- Dated commitments require confirmed, non-stale evidence and a real actionable due date.
- Duplicate sweeps cannot publish the same key again in a local day.
- The main proactive kill switch prevents source reads and writes.

## Explicit remaining verification

GitHub CI verifies TypeScript, mocked calendars/memory and existing repository tests. **A real macOS Calendar AppleScript + TCC permission run, real source-contract opt-in, and seeing the cards in the installed Flyd UI must be verified on George's Mac before claiming a production pilot.** This plan does not enable access on the user's device or send personal data remotely.
