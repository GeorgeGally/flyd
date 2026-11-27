# Flyd v10 — Real Mac acceptance and staged rollout

**Status:** REQUIRED ON-DEVICE PILOT; this document is a procedure, not evidence that a Mac was tested.
**Plan:** [v10 R2–R6](../plans/2026-11-23-flyd-v10-r2-r6-proactive-intelligence-implementation.md)
**Product authority:** [Personal Intelligence PRD](flyd-personal-intelligence-prd.md)
**Code:** `cli/src/runtime/initiative/`

## Principles

- Core's local, consented curiosity is **not** PRESENT and must never widen PRESENT's source capture.
- Evidence Engine may fetch already-public Scout URLs after a **separate** user opt-in. It may NOT transmit local project names, repo contents, memories or private account text in those queries. The published result supports the *public reference*, not an untested claim about the private project.
- A CoS follow-up requires a third, separately user-accepted, project-specific, expiring **read-only** mandate. Its current implementation makes a verified, sourced research report — **it does not edit code or dispatch unrestricted agents**.
- The local event store is canonical; consent can be revoked at any time; no high-impact actions are granted by this feature.
- A CI pass is not proof of usefulness, correct Mac presence, installed Node compatibility, or a working private provider account.

## 1. Get the installed Core into a known state

1. Inspect and preserve local uncommitted work. From the existing Flyd checkout, update `main` via the normal repository workflow.
2. Build, test and install using the repo-supported paths, not a bare pull:

    cd cli && npm run lint && npm test && npm run build
    cd ../mac-adapter && make run

3. Confirm the **actual serving Core** and Mac adapter are current with `flyd doctor --json`. Check that `FLYD_COS` is not set to `0` if CoS follow-through is part of the pilot, and `flyd agenda list` for the active agenda. Do not infer runtime status from a shell Node version; AgentRun has its own live Core compatibility check.
4. `flyd initiative doctor` must identify all source permissions and explicitly say live pilot is **unverified** until a person performs it. No feature should quietly enable private sensing.
5. Baseline with `flyd initiative status` and `flyd initiative stats`. Record counts and any unknown spend/capability status; an empty new install is not a failure.

## 2. Opt in to local curiosity, then public research

- `flyd initiative enable`: permits deriving local hypotheses from already curated projects, Council, Scout and CoS records. This is a **local-only LEARN grant**.
- `FLYD_INITIATIVE=shadow flyd initiative run`: a local inspection with no ambient result. Observe `triaged` rather than the misleading “investigated.”
- `flyd initiative research-enable`: **independent 90-day renewable** opt-in for public Scout research. It does not authorize private model egress. Run `flyd initiative research-run` and verify only the public article title/URL reaches the Evidence Engine.
- Optional: `flyd initiative synthesis-enable` separately permits one bounded quick-model interpretation of **public source excerpts only**. Check the actual configured provider, the outbound redacted payload and that the model text is labeled an **unverified hypothesis**, not a verified implementation or business outcome. `synthesis-disable` and `synthesis-revoke` stop this path and retract any affected derived public-research cards/reports.
- With `FLYD_INITIATIVE=on` (or unset) and both permissions enabled, at most one source-linked initiative card should appear per local day. A public finding must state whether it is single-source, contradicted, absent or backed by different domains, and must **not** claim the technique has already improved a project.
- Test a relevant Creative/technical topic and an unrelated headline. The latter must not create a new job or notification.

## 3. Test an accepted CoS research follow-up

1. Identify an **existing active nonpersonal** curated project ID. Never invent one or expand a person's name from an ambiguous memory.
2. Explicitly authorize that exact project: `flyd initiative authorize-readonly <project-id>`. The permit is restricted to local evidence reporting, one per day, and expires within seven days (or when the project materially changes).
3. With CoS actually enabled, run `flyd agenda run-due` or the installed scheduler. A qualifying already-researched public finding may appear as a **CoS-owned, read-only result** with source URLs. Inspect the accepted objective to ensure `origin.surface=initiative`, not a forged chat utterance. Expect zero unrequested code edits, messages, purchases or deployments.
4. Trigger the same tick twice, restart Core, and run it again. There should be **one accepted read-only objective and one report**, not duplicate work.
5. Change a relevant project field (but not just its unchanged day timestamp); pending old research must stop being eligible. Withdraw `flyd initiative revoke-mandates`, then verify no more CoS work and no previously persisted mandate-derived card remains visible.

## 4. Test explicit usefulness feedback, not fake impact

1. Find a real prepared research candidate ID from the evidence trace or `flyd initiative stats`.
2. Record `flyd initiative review <candidate-id> helpful` or `not_helpful` **only for a source-linked prepared result**.
3. The review should appear as explicit feedback but `verifiedExternalImpact` remains **false/unknown** unless an independent outcome verifier produces real evidence. Repeated identical reviews should not create repeated votes.
4. Verify `flyd initiative stats` distinguishes source corroboration, source uncertainty, explicit usefulness ratings and **unknown impact**. Do not use number of cards or positive reactions to declare the system successful.

## 5. Revocation and privacy drill

Test with a non-sensitive synthetic project before involving real client data.

- `flyd initiative research-revoke` must block new public reads, erase its derived research events/cards, and prevent newly accepted mandate work. Existing local-only curiosity consent may remain.
- `flyd initiative revoke-mandates` must erase mandate authorization, blank the separate generated CoS objective metadata and hide any mandate-backed cards.
- `flyd initiative revoke` must remove all local initiative-derived content, with nonidentifying tombstone receipts only. No old payload should reappear after restart or `flyd initiative renew` unless fresh source consent explicitly recreates it.
- Revoking an upstream CoS source should remove linked initiative events and linked CoS reports, not merely hide one Activity row. Revoking an upstream project should fail closed at live source-revision checks; verify the canonical derivative sweep runs in Core.
- `FLYD_INITIATIVE=0` and `FLYD_INITIATIVE_RESEARCH=0` are immediate feature kill switches. Check Activity desktop and any mobile read-only view without exposing a new local Mac data stream on mobile.

## 6. Usability and evidence-quality pilot (not CI)

Collect a redacted, explicit pilot trace for at least:
1. A creative idea worth exploring, one genuinely distinct technique, and one intentionally superficial keyword overlap.
2. A technical research example with direct official documentation and an independent second source, plus a contradictory/stale source.
3. An important venture/project discrepancy and a case where missing business numbers are treated as missing, not invented.
4. An already accepted CoS read-only report and a denial when the accepted mandate is missing/expired.
5. A day in which **silence** is correct.

Track number of optional interruptions, false novelty, missed important opportunities, correct refutations, time/cost, sources, controls, and George's explicit review. Compare the **same data** against current Council/legacy curiosity. Existing synthetic 120-case regression tests are safety fixtures and **not a blinded measurement of real assistant utility**.

**Release complete only when:** no ungranted effects, no private data leak to public searches, no stale or erased readable derivative, no missed protected decision, acceptable costs, a real user finding worth having, and a signed-off installed Mac acceptance record.

## Commands to recover

- `flyd initiative doctor` — inspect flags, source contracts, budget/health and outstanding sweeps.
- `flyd initiative research-disable` — stop new external evidence searches.
- `flyd initiative revoke-mandates` — stop all new read-only CoS follow-through.
- `flyd initiative disable` — stop local initiative and hide prepared cards while retaining local consent history.
- `flyd initiative revoke` — erase initiative-derived content and credentials/authority grants associated with it; does not erase the separate authoritative originals.
- `FLYD_INITIATIVE=0` — process-level fail-safe if CLI or consent store is unavailable.

**Unfinished capability beyond this release:** substantial investigation of private repository content through an explicit source-scoped local reader, sandbox-authorized design/code experiments, and outcome-based *automatic* policy improvements remain separately gated. Do not claim they are built or deployed until the implementation and Mac traces prove them.
