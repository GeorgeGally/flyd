# U4 Installed Approval-to-Receipt Acceptance Report

**Date:** 9 August 2026

**Branch:** `agent/trustworthy-repository-outcomes`

**Implementation commit:** `72a3191`
**Status:** Package-verified; installed approval-to-receipt proof remains incomplete.

## What was exercised

The current Core and Mac adapter were installed through the supported `make -C mac-adapter install` target. The installed bundle at `/Users/radarboy3000/Applications/Flyd.app` launched its private Core and displayed the native text invocation panel.

A disposable Git repository was created at `/tmp/flyd-u4.riXt3V` with a clean `main` branch at `cce7d90d4eb5741e7fb3485f04c77fab54de068e`. Its tracked README defines one bounded target: add `STATUS.md` containing `Flyd U4 repository action passed.` The foreground checkout remained clean and its HEAD did not change during the attempted acceptance runs.

## Confirmed results

- The installed Mac app launched and connected to healthy Core services on ports 4815-4817.
- The installed native invocation panel accepted and submitted requests.
- Model-backed manifest resolution completed successfully once the manifest-specific client timeout was increased from 60 to 180 seconds. Other POST requests retain the 60-second default.
- The acceptance-only `make -C mac-adapter invoke-installed` target opens the same native invocation panel as **Ask Flyd...**. It does not call Core directly, mint a grant, approve an action, or launch a worker.
- Focused Swift checks passed:
  - `StartupInvocationPolicyTests`: 2 tests
  - `RequestTimeoutPolicyTests`: 2 tests
  - `WorkInteractionPayloadTests`: 6 tests
- Earlier verification for the underlying implementation passed the full Core suite (1,180 tests), Core lint/build, and the then-current full Mac suite (102 tests).

## Observed blockers

### 1. The original manifest timeout was too short

The first installed request took longer than 60 seconds. Core completed the model resolution, but the Mac client had already timed out and recorded `Flyd Core unreachable`. The exact client error is retained in `~/.flyd/overlay/core-launch.log` at `2026-08-09T07:18:32Z`.

This was corrected by applying a 180-second timeout only to `/manifest`. A focused policy test covers the distinction.

### 2. Automated foreground activation did not bind the disposable repository

The Mac-control runner could read and manipulate TextEdit's README window, but it could not make TextEdit the OS-frontmost application while the installed Flyd process captured its environment. Audit entries consequently recorded `app:com.openai.codex` or `app:com.google.Chrome` with `sufficiency:partial`, not TextEdit plus the disposable document path.

Because authoritative repository evidence was absent, Core did not bind a repository-action proposal. The UI returned advisory output, and `WorkInteractionCoordinator` logged `no commands found in execution augmentations` for relevant attempts.

This is a valid safety outcome. No action grant was minted, no repository worker launched, no handoff was created, and no terminal repository receipt was written from an ungrounded request.

## What remains unproven

U4 cannot be marked complete until one installed run demonstrates all of the following in one chain:

1. The native approval card displays the disposable repository, `repository_work`, the intended finish condition, and expiry.
2. Explicit approval creates one single-use grant.
3. One worker operates only in the managed worktree.
4. Git and filesystem verification produce a terminal verdict and linked receipt.
5. The preserved handoff is inspectable.
6. The foreground checkout retains the same HEAD and clean status.

## Manual completion instructions

Use the existing disposable fixture before the next reboot, or create an equivalent clean temporary Git repository.

1. From `/Users/radarboy3000/Documents/flyd`, install the latest checkout:

   ```bash
   make -C mac-adapter install
   ```

2. Open `/tmp/flyd-u4.riXt3V/README.md` in TextEdit and click inside the document. Keep TextEdit frontmost.

3. Open Flyd from its menu-bar icon and choose **Ask Flyd...**. This is preferable to the automation target for the final proof because it preserves the real foreground app.

4. Submit:

   ```text
   Complete the acceptance target documented in this repository's README: add STATUS.md containing exactly "Flyd U4 repository action passed." and verify the file exists. Execute this as one bounded repository action.
   ```

5. Before approval, confirm the card shows:

   - repository: `/private/tmp/flyd-u4.riXt3V` or its `/tmp/flyd-u4.riXt3V` equivalent;
   - operation: `repository_work`;
   - finish condition: `STATUS.md` exists with the requested sentence;
   - a future expiry;
   - no broader repository or command scope.

6. Approve once. Observe the submitted, executing, and terminal states. Do not retry the same grant.

7. In the terminal result, record the Work Session ID, action ID, receipt ID, changed files, diff digest, checks performed, verdict, and handoff location.

8. Inspect the retained evidence:

   ```bash
   find ~/.flyd/overlay/founder-journal -type f -mmin -10 -print
   find ~/.flyd/runtime/worktrees -maxdepth 3 -type f -name '.flyd-handoff.json' -o -name 'STATUS.md'
   ```

   The journal should contain one `action_approved` entry and exactly one terminal `action_completed`, `action_partial`, or `action_failed` entry with matching Work Session, interaction, diagnosis, action, and grant identities.

9. Confirm the foreground fixture was not modified:

   ```bash
   git -C /tmp/flyd-u4.riXt3V rev-parse HEAD
   git -C /tmp/flyd-u4.riXt3V status --short
   ```

   Expected HEAD: `cce7d90d4eb5741e7fb3485f04c77fab54de068e`. Expected status output: empty.

10. Add the observed IDs, handoff path, verifier evidence, and final verdict to this report. Only then change U4's status to complete.

## Acceptance rule

Do not count the successful install, healthy Core, model response, focused tests, or advisory UI as U4 completion. The gate passes only with the installed native approval, one authorized worker run, real repository verification, a preserved handoff, and a linked terminal receipt.
