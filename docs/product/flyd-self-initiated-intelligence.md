# Flyd — Self-Initiated Intelligence (v10, R1)

**Status:** First governed vertical slice implemented in source; disabled until explicit LEARN opt-in. Full v10 plan remains incomplete.
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

No provider/API/model call is made by this release, and no additional source is sensed. Its local inspection is deliberately modest: it contrasts *the actual recorded observations* and proposes a falsifiable follow-up. It does **not** claim to have performed a code audit, visited the external article, prototyped a design or verified the idea.

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
