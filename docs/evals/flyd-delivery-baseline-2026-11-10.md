# Delivery and companion baseline (2026-11-10)

Split-plan Phase 0 (`docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md`). This is today's Flyd at `main` = `92f522ee`, before any delivery or Chief of Staff work. Phase 1 and every later phase rerun the same commands and compare against these numbers.

## The four numbers

| Measure | Baseline | Phase 1 target |
|---|---|---|
| Delivery pass rate | **1/21 (5%)**; real examples 1/9; judged clarity 5.8/10 over the 11 that said anything | ≥ 90% of fixtures, every real example, clarity ≥ 8 |
| Companion mean judge score | **6.4/10** over 10 cases (5/10 pass) | +0.5 by Phase 5 |
| Delegate-case pass rate | **4/4 (100%)** | at or above baseline |
| Delegate-turn latency | **p50 10.9 s · p95 13.6 s** | at or below baseline |

## How to reproduce

```bash
cd cli
# How finished work reaches George (sandboxed: nothing touches ~/.flyd or the staff)
FLYD_CLAUDE=0 FLYD_MODEL=openai:gpt-5.6-luna npm run evals:chat -- --suite delivery
# Companion and delegate cases (read-only against the real home)
FLYD_CLAUDE=0 FLYD_MODEL=openai:gpt-5.6-luna npm run evals:chat -- --model openai:gpt-5.6-luna --only vent-gallery-silence,vent-long-day,vent-code-frustration,vent-money-worry,think-pricing-idea,think-side-project,think-hiring,think-move,decide-weekend,decide-laptop,delegate-code-fix,delegate-research,delegate-design-lab,delegate-background
```

Add `--tools split` to measure Flyd without its code-writing tools, and `--soul <path>` to try another voice.

- **Pinned models.** Chat and one-shot jobs: `openai:gpt-5.6-luna` (the documented fallback). Judge: `openai:gpt-5.6-sol`. On the day, the configured `opencode-go` chain answered 402, and `FLYD_CLAUDE=0` keeps the metered Claude chain out of eval runs.
- **Variance.** Three delivery runs on the same code gave 1 to 2 passes out of 21. Single judged scores moved by up to 3 points between runs. Compare means and pass counts, not single scores.

## What the delivery suite does

`cli/src/evals/chat/delivery.json` holds 21 cases. Twelve are fixtures, one for each rule in the Delivery standard: a lab with a pick, a long report, code that landed, a three-way decision, a failure, a seven-item status, short answers, a UI change, a booking, and the window's landed, decision and routine-chatter replies. Nine are real deliveries George was shown, taken from the 2026-11-10 PA deep dive:

- the staff questions passed through word for word ("parked at review: 1 finding(s) · ask-user: authority decision", the Pages phases question repeated 7 times, "Waiting on George's three calls recorded in cap5-dash-lab-r5-calls");
- the "Do first: CapFive's cookie consent." line sent on six mornings;
- "Flyd couldn't answer this: <exception>";
- the Expected / Observed / Cause / Evidence / Next card;
- three relay lines the reply checks caught.

Each case goes through today's code for its surface (`delivery-run.ts`): a finished run through `notifyRun` and the review step, a staff reply through the window's `AnswerInterpreter`, Flyd's own answer body as the window renders it, and a failed window turn through `FlydDesk`. The morning line has no replayable path yet, so it is scored as he saw it until Phase 1 owns that delivery. Scoring (`delivery-scoring.ts`, unit-tested) reads only what he would see:

- did anything reach him, and should it have;
- the shape the Delivery standard requires;
- a lead line of at most 120 characters, at most 3 lines and at most 360 characters;
- no backstage names, paths, task ids, staff words, error text, card labels, talk about him in the third person, repeats, or repeats of what he was already told;
- a judged clarity score of at least 7.

## What the baseline shows

- **Most finished work never reaches him.** 9 of the 12 notification-path runs reached him with nothing. On a finished answer the review step decides "routine operational state stays backstage", which is problem 3 of the deep dive. Split-plan build 2 (tell George when work is done) and Phase 1 fix it.
- **Nothing has a shape.** Every delivery is words. Lab picks, landed code, decisions and long reports all come out as prose or not at all.
- **Staff words still pass through.** "Waiting on George's three calls recorded in cap5-dash-lab-r5-calls" reaches him as written, twice over in one line.
- **Raw errors and repeated mornings fail outright** (judged 2/10).
- **What already works.** The diagnosis card now reaches him as a short PA reply (PR #252), and the window's reading of a staff reply is clear (judged 8 to 10). It still runs past one 120-character line, still reports routine progress, and never chooses a decision card or a landed line.
- **Companion turns** pass half the time. The usual failure is turning a feeling or an idea into a plan or a roadmap.

## Per case

### Delivery (results `2026-11-10T05-47-43`)

| Case | Origin | Surface | Result | Judge | Why it failed |
|---|---|---|---|---|---|
| `lab-three-versions` | fixture | notification | fail | – | nothing reached him |
| `research-long-report` | fixture | notification | fail | 9 | delivered as words, expected document; lead line 136 chars > 120 |
| `code-landed` | fixture | notification | fail | – | nothing reached him |
| `decision-three-options` | fixture | notification | fail | 3 | lead line 139 chars > 120; judge 3/10 |
| `failure-plain-sentence` | fixture | notification | fail | – | nothing reached him |
| `seven-item-status` | fixture | notification | fail | – | nothing reached him |
| `short-answer` | fixture | notification | fail | – | nothing reached him |
| `ui-change-picture` | fixture | notification | fail | – | nothing reached him |
| `background-booking` | fixture | notification | fail | – | nothing reached him |
| `window-landed` | fixture | window | fail | 10 | delivered as words, expected landed |
| `window-decision` | fixture | window | fail | 8 | delivered as words, expected decision |
| `window-routine-chatter` | fixture | window | fail | – | told him about routine progress Flyd should keep |
| `real-parked-at-review` | real | notification | fail | – | nothing reached him |
| `real-pages-phases-repeated` | real | notification | fail | – | nothing reached him |
| `real-waiting-on-georges-calls` | real | notification | fail | 2 | lead 136 chars; task id; talks about him, not to him |
| `real-do-first-six-mornings` | real | recorded | fail | 2 | tells him what he was already told |
| `real-desk-raw-error` | real | desk-error | fail | 2 | shows him the error |
| `real-diagnosis-card` | real | answer | fail | 6 | judge 6/10 (9/10 on an earlier run) |
| `real-relay-ready-on-branch` | real | window | fail | 5 | judge 5/10 |
| `real-relay-remote-codex` | real | window | fail | 9 | lead line 131 chars > 120 |
| `real-relay-pr-checks` | real | window | pass | 8 | |

### Companion and delegate (results `2026-11-10T05-43-29`)

| Case | Category | Result | Judge | Seconds |
|---|---|---|---|---|
| `vent-gallery-silence` | companion | pass | 7 | 9.7 |
| `vent-long-day` | companion | pass | 8 | 4.7 |
| `vent-code-frustration` | companion | fail | 5 | 10.8 |
| `vent-money-worry` | companion | pass | 7 | 13.6 |
| `think-pricing-idea` | companion | fail | 6 | 6.4 |
| `think-side-project` | companion | pass | 7 | 9.2 |
| `think-hiring` | companion | fail | 6 | 9.1 |
| `think-move` | companion | fail | 4 | 11.6 |
| `decide-weekend` | companion | pass | 8 | 10.6 |
| `decide-laptop` | companion | fail | 6 | 11.6 |
| `delegate-code-fix` | delegate | pass | – | 8.9 |
| `delegate-research` | delegate | pass | – | 13.6 |
| `delegate-design-lab` | delegate | pass | – | 10.9 |
| `delegate-background` | delegate | pass | – | 12.7 |

## Not covered yet

- The plan's two "how's my work going?" cases with seeded objectives. They wait for `Objective` (Phase 3).
- George's own picks of bad deliveries. Each one he sends becomes a `real` case in `delivery.json`.
