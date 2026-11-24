# Flyd model strategy: which model makes which decision

Scout, read-only. Date 2026-11-24. Evidence is from the repo (HEAD 6917d74b), `~/.flyd/claude-spend.json`, `~/.flyd/cognition/jev-health/`, and an offline run of `npm run evals -- system-one-replay`.

## Bottom line

George's instinct is half right.

- **Jev is already wide but shallow.** About 45 predicates are `production`, mostly cheap yes/no or pick-one gates. Jev decides *routing and gating*. It decides nothing that needs judgment.
- **The "advanced reasoning" models are almost unused.** Every text decision (chat, background, quick, worker) runs on one model, OpenCode Go `gpt-6-luna`, with Claude Sonnet/Haiku only as fallback. `~/.flyd/models.json` does not exist, so these are code defaults (`cli/src/runtime/model-routing.ts:38-49`).
- **Nothing is routed by difficulty.** The Jev predicate that would do it, `needs_reasoning_model`, scores 100% in replay (10 cases) but is `proposed`, with no consumer (`registry.ts:538-546`: "every invocation that reaches a model uses the main model today").
- **No decision uses an OpenAI or Gemini reasoning tier.** `openai:gpt-5.6-sol` appears only as eval judge and in `flyd profile`.

## 1. Decision → model today

Defaults from `model-routing.ts:36-49`. Order is first choice, then fallback.

| Decision type | Job | Runs on | Evidence |
|---|---|---|---|
| Chat answers, tool loops, agenda runs | `chat` | `opencode-go:gpt-6-luna` → `claude-sonnet-5-5` | `conversation-responder.ts:1336` uses `chatModelChain()` |
| Turn routing (read-the-room), query rewrites, view routing, reply summaries, status lines, typing prediction | `quick` | luna → `claude-haiku-5-5` | `llm.ts:273`; `composer-predictions.ts:11` |
| Council, taste, curation, learning, **news ranking/edition**, synthesis | `background` | luna → haiku | `docs/product/flyd-models.md:57` |
| Overlay questions (fn key), LIVE look-ups, `flyd code` | `worker` | luna → haiku | `flyd-worker-config.ts:114` |
| Coding (crew) | `crew` | Claude Code subscription, default model | `model-routing.ts:44` |
| **Creative judgment** (Creative Director, lab review, Designers) | `design` | Claude **Opus** via `claude` CLI (subscription) | `model-routing.ts:45`, `design-claude.ts:16` |
| Acceptance/diff review | `checker` | another family than the builder, picked from chat/quick/background | `config.ts:229-231` |
| Proactive planning (agenda, initiative, CoS tick) | `chat`/`quick`/`background` | luna by default; CoS acceptance via `checkerModelChain` | `command/cos/tick.ts:868-881` |
| Routing/gating (chat route, memory rerank, curator, presentation, CoS dispositions, self-review) | Jev | `jev-latest` (pinned `jev-1.13.0` for thresholds) | `jev.ts:19-27` |

One model does nearly all the thinking: only creative judgment (Opus) and images get their own. LIVE voice (`gpt-realtime-2.1`) is fixed.

**Open discrepancy.** November's metered Claude spend is **$44.72 over 18,731 calls**: `chat` $22.15 (443 calls), `quick` $21.82 (12,366), `card-words` $0.72. Defaults say OpenCode Go answers first, so Claude is billing for most of these calls. Either OpenCode Go fails often and falls through to Claude, or something sets explicit Claude chains. I did not find which. Check `flyd doctor` failover and the audit log before changing the map, because "Luna is the default" may not describe real behaviour.

## 2. What Jev decides, and how well

**Mechanism.** Calls go to TypeSafe `api.typesafe.ai/v1/systemone` with a bounded, redacted state projection of at most 64 KB, a 1.2 s timeout and a fail-open fallback (`jev.ts`). Question types are Noul (yes/no probability), Choice (argmax) and Score. Cost is input tokens only, **$0.042 per million, with output free** (`jev.ts:28`). Latency p50 is about 290 ms and p90 about 330-410 ms. Each predicate is declared in `registry.ts` and replay-scored before use.

**Where it is live.** Router, curator lifecycle, memory rerank, interpret, chat-turn route/preparation, skill/note relevance, self-review, presentation judges, and CoS dispositions/recovery (`router.ts`, `runtime/turn-plan.ts`, `curator.ts`, `conversation-view/*-judge.ts`, `command/cos/*`).

**Status now.** Health is `ready` since 2026-11-23T05:59Z. `FLYD_JEV_ENABLED` is set in `.env`; I did not print the value. A Gemini decision provider (`decision-provider.ts`, `gemini-decision-1`, $0.10/M) exists and is used by the CoS recovery runner (`recovery-runner.ts:184`). I could not verify that endpoint (`.../v1beta/decisions`) as a real public API, so treat it as unvalidated.

**Replay calibration (offline recorded run).** The bench is **red**: `answer_form` has 20 stale `v1` recordings against `v2`, so Jev abstains on all 20 (0% accuracy, versus 35% for the current heuristic). The prior commit `35e45149` already says so. Scores, n is small and synthetic:

| Predicate | n | Jev acc | Incumbent acc |
|---|---|---|---|
| route_kind | 24 | 96% | 83% |
| chat_turn_route (no incumbent) | 40 | 93% | n/a |
| reply_artefact_kind | 11 | 100% | 27% |
| cos_internal_decision / outcome_first | 8 / 8 | 100% / 100% | 75% / 88% |
| invocation_mode (proposed) | 24 | 92% | 13% |
| needs_web (proposed) | 14 | 93% | 79% |
| needs_reasoning_model (proposed) | 10 | **100%** | 40% |
| current_state | 12 | 83% | 92% |
| cos_off_voice | 12 | 58% (42% abstain) | 67% |
| muse_should_speak / learning_supported (proposed) | 10 / 10 | 60% / 20% | 50% / 40% |
| answer_form | 20 | 0% (stale) | 35% |

**Reading.** Jev is strong on closed-set routing and weak or abstaining on open judgment (Muse speak, learning support, tone). Samples are 4-40 synthetic cases, so "100%" means "not obviously broken", not a calibrated rate; no production-trace holdout exists.

## 3. Where a stronger model or a Jev head pays off

**Jev head (cheap, fast, closed-set). Gains most where today's heuristic is wrong.**
1. **`needs_reasoning_model` → model tier router.** The most important unused piece. It would send easy turns to a small model and hard ones to a reasoning model. 100% on 10 cases vs 40% for the incumbent; promote it first, behind the existing replay gate.
2. **`invocation_mode` / `needs_web`.** The front door sends nearly everything to `work_help` (13%); Jev scores 92%.
3. **`answer_form`.** Re-record at v2 live, then judge.

**Stronger reasoning model. Gains most where the answer is generated judgment, not a label.**
1. **Chat turns Jev flags as reasoning-heavy** (debugging, planning, weighing sources, deep research). Today these share Luna with greetings.
2. **Proactive planning and the initiative/CoS tick.** Rare, high-stakes, long-horizon. Cost is negligible at this volume.
3. **Taste and council synthesis, news edition ranking.** Daily batch jobs where quality compounds. Luna is the weakest link for "what matters to George".
4. **Checker/review.** Already cross-family; make it the strongest family available.
5. **Creative judgment is already on Opus.** Leave it; at most trial Gemini as a second screenshot judge.

**Do not upgrade** composer prediction, card-words, status lines, summaries or routing reads: high volume (12k+ quick calls), low stakes.

## 4. Rough cost per day

Using Flyd's own prices from `claude-spend.json` and `claude-spend.ts:18-24`: Haiku 5 at $0.10/$0.50 per M, Sonnet 5 at $2/$10, Opus 5.5 at $4/$20. Month to date is 24 days.

- **Today, metered Claude:** $44.72 / 24 ≈ **$1.86 per day** (chat ≈ $0.92, quick ≈ $0.91).
- **Unit costs:** chat ≈ $0.050 per call (≈18/day); quick ≈ $0.0018 per call (≈515/day).
- **Jev for all routing:** even at 2,000 decisions per day and about 1.5k input tokens each, that is 3M tokens × $0.042 = **about $0.13 per day**. Output is free, so adding more Jev heads is almost free.
- **Reasoning tier on hard chat turns only.** If Jev sends 30% of 18 turns (about 5 per day) to an Opus-class model at roughly $0.10 per call, that adds **about $0.50 per day**.
- **Daily batch jobs** (taste, council, news, planning), perhaps 20 calls at about $0.15 on a reasoning model: **about $3 per day**.
- **Total plausible uplift: about $3-4 per day (~$100/month)**, against a default `FLYD_CLAUDE_MONTHLY_CAP_USD=100`: raise the cap or route the batch tier off Claude.
- Opus-class figures are a ceiling proxy, not a quote; get real OpenAI/Gemini prices first.

## 5. Recommended model map

| Decision type | Recommended | Why |
|---|---|---|
| Route / gate / classify (all closed-set) | **Jev** (pinned release) | Cheaper, ~300 ms, beats heuristics in replay |
| Tier choice per turn | **Jev `needs_reasoning_model`** → small or reasoning model | Missing piece; promote through replay |
| Easy chat, greetings, summaries, predictions, status lines | small model (Luna or Haiku) | Volume, low stakes |
| Hard chat (debug, plan, weigh sources, deep research) | **reasoning tier** (OpenAI sol-class or Sonnet/Opus) | Judgment quality |
| Proactive planning, CoS objectives, initiative | reasoning tier | Rare, high stakes |
| Taste, council, news edition ranking | reasoning tier, batch (once daily, cheap) | Compounds; Luna weakest here |
| Creative direction and review | keep Opus; trial Gemini as second vision judge | Already strongest |
| Checker/review | strongest cross-family model | Independent check only counts if strong |
| Open-ended judgment (muse_should_speak, learning support, tone) | **not Jev**; a reasoning model, or keep deterministic rules | Jev scores 20-60% |

## 6. Recommended next steps (smallest first)

1. **Explain the $44 Claude spend** (`flyd doctor --json`): why is OpenCode Go not answering first? The map rests on this baseline.
2. **Re-record `answer_form` live** and get the replay bench green. This gates all promotions.
3. **Wire `needs_reasoning_model`** as the first consumer, changing `chat` to pick a tier. Start in shadow/recorded mode and log disagreements.
4. **Add a `reasoning` job to `MODEL_JOBS`** in `model-routing.ts` and move taste, council, news and the proactive tick onto it. This is a models.json-level change that respects "no model changes without asking": George must approve which model fills it.
5. **Collect real traces** before promoting anything on synthetic cases alone.

## Caveats

No live provider was called; Jev health is from its last recorded file. Per-day figures are monthly totals divided by 24. Luna, OpenAI and Gemini reasoning prices are not in the repo.
