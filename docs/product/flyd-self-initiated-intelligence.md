# Flyd — Self-Initiated Intelligence (v10: local curiosity, public evidence and scoped research follow-through)

**Status:** R1 local curiosity merged. R2–R6 **implementation branch** extends it with source erasure, optional public-only evidence investigation, read-only user-accepted CoS reporting, explicit feedback, safety replay and Mac pilot runbook. Production readiness still depends on green CI, on-device consent testing and measured usefulness.
**Plan:** [2026-11-23 self-initiated intelligence v10](../plans/2026-11-23-flyd-self-initiated-intelligence-v10.md)
**Product authority:** [Flyd Personal Intelligence PRD](flyd-personal-intelligence-prd.md), especially source consent, action authority and provenance.

## The experience

Flyd should not wait for a question before it recognizes a relevant risk, technical obstacle or creative opportunity. The first release takes already-curated **project**, **Scout**, **Council** and **CoS report** records and runs a bounded local check inside the existing agenda tick.

The candidate producer currently recognizes:
- A public Scout reference that introduces **at least one distinct term or technique** to an actively curated creative/product project; generic topic repetition is rejected.
- A venture/client/work project explicitly marked **waiting** with an approaching, recorded due date and next step. It asks what evidence is still needed; it does not infer a missed commitment.
- An existing evidence-linked Council advisory. This remains private rather than generating a second public Council message.
- Two separate CoS objectives reporting similar blocked outcomes, forming a *hypothesis* about a shared cause. The original CoS owners are not replaced or retried.

For each eligible candidate, the code records source identity/revision, an answerable question, a counter-hypothesis, an inexpensive next check, and a deterministic value-of-information decision. The result is a **proposal**, never a verified outcome. A candidate with two independently traceable operational/public sources can appear as **one quiet Activity item per day**, never a popup, fake task, notification or new Chief-of-Staff objective.

### Architecture

    Existing agenda tick (no new daemon)
       ↳ read consent: initiative.curated
       ↳ derive candidate from existing curated/public sources
       ↳ rank and validate sources, current revision, evidence and uncertainty
       ↳ append decision + unverified proposal to canonical IntelligenceEventStore
       ↳ shadow: no user-facing output
       ↳ enabled: up to one quiet existing Activity item/day
       ↳ ActivityReader rechecks parent sources and source contract on every refresh

The **R1 local triage** makes no provider/API/model call and senses no additional source. A separate, explicitly enabled **public-only research pass** may call existing EvidenceEngine to check already-public Scout references; it does not transmit private project data. Its local inspection is deliberately modest: it contrasts *the actual recorded observations* and proposes a falsifiable follow-up. It does **not** claim to have performed a code audit, visited the external article, prototyped a design or verified the idea.

### Controls

The new local LEARN source is **disabled by default**, has a declared 30-day retention period and no model egress destinations.

- `flyd initiative status` — current source consent and presentation mode, no private text.
- `flyd initiative enable` — explicit local opt-in. Normal mode shows at most one grounded Activity item per day.
- `FLYD_INITIATIVE=shadow` — record decisions locally but show no candidate to George.
- `flyd initiative run` — perform one synchronous sweep, using the same current consent gate.
- `flyd initiative pause` or `disable` — immediately stop future source reads and hide previously prepared Activity items.
- `flyd initiative revoke` — revoke consent, tombstone the initiative event source, erase stored initiative Activity lines, and hide cards. It does not erase the separate authoritative original project/Scout/CoS records.
- `flyd initiative renew` then `enable` — explicitly create a fresh consent generation; erased derived events stay erased.
- `FLYD_INITIATIVE=0` — top-level kill switch, independent of source consent.

**Source permissions and revocation:** The reader rechecks parent project revision, Council status, Scout edition revision and canonical CoS event erasure. A changed/missing parent hides the old displayed idea. At this stage only local operational/public sources are eligible; personal communications, health, location, financial accounts, raw screen/mic and Calendar titles are **not** inputs. This release does not infer an external-data egress grant from the local source opt-in.

**No CoS work without mandate:** The proposal lifecycle cannot create an objective, capability grant or external effect. A later release may only dispatch researched work under an existing authorized target/scope/budget and verified CoS receipt.

### Current limitations (do not conflate R1 with full v10)

1. **Not deep autonomous research yet.** The local investigation labels what the curated sources show and what remains unknown. It does not fetch new evidence, call an LLM or build a prototype; those need independent source-specific egress/authority and cost gates.
2. **Not broad personal sensing.** Cross-domain life/relationship/finance signals depend on separate explicit source contracts. Calendar-only proactivity is not the goal, but the current slice deliberately does not invent permission for high-sensitivity data.
3. **Not autonomous CoS delegation.** New work must be an accepted objective or carry an expiring scoped standing mandate; no such grant is minted here.
4. **No adaptive user-impact model.** Source/idea quality and missed-opportunity recall must beat the existing Council + legacy curiosity baseline before policy promotion.
5. **Erasure propagation:** Disabling/revoking the initiative source hides all initiative cards and the explicit revoke command erases its own events/cards. Independent erasure of one *upstream* project/Scout source hides affected views by live-source validation; cleanup of historical derived event payloads by individual upstream lineage is **still a release gate** before general sensitive-source expansion.
6. **No installed Mac proof.** GitHub CI validates the code and synthetic regressions only; consent, Core scheduling, UI freshness and practical usefulness need a real local pilot.

### Tests and mandatory acceptance

`cli/src/runtime/__tests__/initiative-cycle.test.ts` covers new-source novelty, stalled venture dates, Council evidence, repeated CoS failures, source revocation, no-consent/no-read, safe unverified event kinds, idempotency and the live Activity reader. The existing `runtime/agenda-tick.ts` runs the new job through the same model-backoff-independent tick and existing source checks.

**Next release gate:** replay ≥120 source-grounded, privacy-safe cases, compare against existing Council/daemon curiosity and run an explicit consented Mac pilot. If new questions are not materially better than the baseline, improve the existing sources instead of creating more infrastructure.


## Subsequent R2–R6 source changes — scope and acceptance boundary

**What is implemented in source on PR #343:**

- **P0 / R2 groundwork:** project/advisory/Scout sources now carry content-based revisions; R1 shadow counts are **triaged** rather than “investigated.” Source changes invalidate stale derived events and UI. The event spine can retract derived cases, research, feedback and associated CoS reports when their parents are erased; derived payloads have a 30-day retention purge and invalidated episode/replay projections.
- **P1:** explicit `initiative.public-research` opt-in lets existing EvidenceEngine check the public Scout URL/title against other accessible public sources under a bounded query/time/attempt budget. Query projection is gated by exact source+destination+purpose checks and excludes private project details. It records **source_confirmed / inconclusive / contradictory / no_evidence / stale / failed / not_permitted**. Confirmed sources are **not** a verified project improvement.
- **P2 (restricted, safe slice):** a separate explicit CLI acceptance stores an expiring, project-content-fingerprinted `initiative.mandate` for **read-only evidence reports only**. A qualifying independently checked result is recorded in an idempotent, CoS-owned `initiative` objective and `cos.report`. No unrestricted FirstMate, Librarian, coding, design, repo-write, email or publication dispatch is authorized.
- **P3:** the existing Activity UI can show one quiet, source-backed research result or an authorized CoS research follow-up, with live source/consent checks. It does not inject private initiative notes into Jev or a chat model, which would otherwise violate the local-only LEARN consent. Full context-sensitive, content-generated conversation manifestation remains an expansion gate.
- **P4:** explicit `flyd initiative review <candidate-id> helpful|not_helpful` produces local user-feedback evidence; `stats` keeps feedback distinct from **unknown external impact**. Frozen, synthetic 120-case safety replay counts missed opportunities, false positive initiative, protected regressions and cost coverage; it is **not** real-world model-quality proof and cannot auto-promote a policy.
- **P5:** the on-device acceptance runbook specifies install, consent, privacy erasure and useful-output drills. A GitHub build does not establish that these passed on George's Mac.
- **P6:** `doctor`, `stats`, per-day claim budget, separate research and mandate revoke/renew, independent kill switches and canonical receipts. There is no automatic unattended rollout of new higher-impact capabilities.

**New controls** (in addition to R1):
- `flyd initiative research-enable` / `research-disable` / `research-revoke` / `research-renew` / `research-run`
- `flyd initiative authorize-readonly <project-id>` / `revoke-mandates` / `renew-mandates`
- `flyd initiative review <candidate-id> helpful|not_helpful`
- `flyd initiative stats` / `doctor`
- `FLYD_INITIATIVE_RESEARCH=0` (public research kill switch)

All three consents—curated local intelligence, public evidence retrieval, and project-specific read-only follow-through—are independent and disabled by default. The latter two do not authorize model transmission of private context, writing files to code repositories, sending external messages or spending money.

### Unfinished before v10 can honestly be called complete

1. **Actual installed Mac proof and real source/provider trace.** Requires the user's device, Core instance, configured provider/account and affirmative permission.
2. **Broader, original multimodal curiosity with selectively permitted model synthesis:** current tests prove source-bound public evidence checking and narrow project/waiting/CoS signals, not a world-class independent creative or business strategist.
3. **Sandboxed, reversible implementation/design experiments under durable grants:** the shipped CoS follow-through writes only an existing research report, deliberately not automatic code changes.
4. **Outcome-based policy optimization against real held-out work:** synthetic safety fixtures are not a blinded quality baseline, user reviews are not measured effects, and the existing in-memory PolicyRegistry cannot alone ensure durable rollout after a crash.
5. **Cross-surface visual/voice proof and sensitive-source expansion:** needs separately reviewed egress permissions and source-specific end-to-end tests.

**Mac pilot instructions:** [Flyd v10 proactive acceptance](flyd-v10-proactive-intelligence-mac-acceptance.md). The full plan remains [v10 R2–R6](../plans/2026-11-23-flyd-v10-r2-r6-proactive-intelligence-implementation.md).
