# Plan: Looki-Inspired Proactive Memory for flyd

## Summary

flyd captures everything and retrieves on demand. The Looki article points at a deeper pattern: memory systems should develop their own sense of **significance, unresolved questions, and changing patterns**. The LLM call is almost trivial once you have the right context.

This plan adds five capabilities to flyd — in order of dependency and risk — to move from passive retrieval to proactive attention:

1. **Event-first memory** — captures store observations, not just conclusions
2. **Attention layer** — multi-signal scoring beyond staleness
3. **Tension engine** — goals vs reality, continuously monitored
4. **Curiosity mode** — daemon asks its own questions, not just answers yours
5. **Inner thought loop** — scheduled reflection with nudge surface

All changes are additive. No breaking changes to existing commands. All LLM calls default-on but can be disabled via config.

## Design Principles

1. **Additive only.** New modules (`src/lib/attention.ts`, `src/lib/tension.ts`, etc.). Existing pipelines untouched.
2. **Opt-out LLM calls.** Proactive features default-on. Disable via `flyd config --set proactive=false`.
3. **Markdown is the API.** Attention reports, tension summaries, thought logs — all plain markdown in `wiki/`.
4. **Human in the loop.** Daemon proposes, does not act unilaterally on anything impactful. Nudges go to a queue, not push notifications.
5. **Budget-aware.** Every proactive LLM call costs money. The daemon tracks and respects a daily spend limit.

## Rollback Safety

- All new state files go in `~/.flyd/state/` (new directory, separate from cache/)
- Old daemon state still works if new modules are absent
- `flyd config --set proactive=false` disables the entire proactive layer in one switch
- Each module has its own disable flag: `attention=false`, `tension=false`, `curiosity=false`

---

## Phase 1: Event-First Memory (low risk, unlocks everything)

**Problem:** flyd stores conclusions. "George likes X." But humans remember experiences first. If the conclusion is wrong, there's no evidence to re-evaluate.

**Solution:** Extend capture frontmatter with event fields. Store the observation, not the belief.

### 1a. Frontmatter Schema Extension

New optional fields in raw capture frontmatter:

```yaml
type: event          # event | observation | decision | belief | goal
signal: budget_resistance   # extracted signal from the event
confidence: 0.8      # 0-1, how sure are we about this signal
participants:        # who was involved
  - George
  - Sponsor Gino
outcome: declined    # what happened
topics:              # inferred topics
  - sponsorship
  - koko
```

`type` defaults to `observation` if absent. Existing captures remain valid.

**Files:**
- `src/lib/schema.ts` (new, ~30 lines) — event schema types and validation
- `src/lib/entity-extractor.ts` (already exists) — extend to populate `participants`, `topics`, `signal`

**How it gets populated:**
- Manual: user writes captures with full frontmatter
- Semi-auto: `flyd capture <text>` runs through lightweight LLM prompt to suggest `type`, `signal`, `confidence`
- Auto: daemon runs captures through entity extractor on batch ingest

### 1b. Event Store vs Belief Store

New wiki folders:

```
wiki/events/        # raw events (episodic memory)
wiki/beliefs/         # derived beliefs (semantic memory) — auto-generated
```

`events/` pages are human-written or auto-captured. `beliefs/` pages are LLM-generated from event clusters.

Example `events/sponsor-meeting-2024-06-01.md`:
```markdown
---
date: 2024-06-01
type: event
signal: budget_resistance
confidence: 0.85
participants:
  - George
  - Sponsor Gino
outcome: declined
topics:
  - sponsorship
  - koko
---

Met with Gino. He liked the concept but said budget is locked until Q3.
```

Example `beliefs/koko-funding-prospects.md` (auto-generated):
```markdown
---
derived_from:
  - events/sponsor-meeting-2024-06-01.md
confidence: 0.6
last_updated: 2024-06-04
---

## Belief: Koko funding prospects

Based on 3 sponsor meetings, 2 declined due to budget timing, 1 pending.

Confidence: Moderate. Budget resistance is the primary blocker.

## Supporting Events
- [[events/sponsor-meeting-2024-06-01.md|Gino meeting]]
- [[events/sponsor-meeting-2024-05-15.md|Prior meeting]]
```

**Belief generation:** Triggered by daemon when N new events share a topic. Lightweight LLM call (~200 tokens) to summarize cluster.

### 1c. Backfill Strategy

**Question for user:** Existing 450+ captures have no event metadata. Do we:

- **A) Lazy backfill** — only new captures get event fields. Old captures remain as-is. Beliefs only derive from new events.
- **B) Batch backfill** — run all 450 captures through entity extractor once to populate `type`, `signal`, `participants`, `topics`. ~$2-5 in API costs. One-time.
- **C) Hybrid** — backfill only captures that match active interests. Cheaper, but incomplete.

**Recommendation:** B) Batch backfill. The entity extractor already exists (`src/lib/entity-extractor.ts`). One `flyd daemon backfill` command. After backfill, the belief system has signal-rich data to work with.

---

## Phase 2: Attention Layer (medium risk, requires event schema)

**Problem:** Staleness (`src/lib/decay.ts`) is one-dimensional: "how old is this?" Real attention is multi-signal:

- **Changing** — is this topic's velocity accelerating or decelerating?
- **Unresolved** — are there open questions or tensions?
- **Surprising** — does new evidence contradict old beliefs?
- **Important** — does this touch active goals or interests?

**Solution:** `src/lib/attention.ts` computes a composite attention score per topic/page. Daemon runs attention scan periodically. Outputs `wiki/attention-report.md`.

### 2a. Attention Signals

Each signal is 0-1, computed from existing data:

| Signal | Data Source | Formula |
|--------|-------------|---------|
| **Recency** | `date` frontmatter | Exponential decay (existing) |
| **Velocity** | Event count per topic, last 30 days | `min(1, count / 10)` |
| **Unresolved** | Open questions in `wiki/questions/` or `outcome: pending` events | `open_count / total_count` |
| **Surprise** | New events that contradict `beliefs/` pages | Semantic similarity check (cheap: keyword overlap) |
| **Importance** | Active interests match | `getActiveInterests()` overlap |
| **Tension** | Phase 3 output | 0 if no tension engine, else `tension_score` |

Composite attention = weighted average. Default weights: recency 0.15, velocity 0.2, unresolved 0.2, surprise 0.2, importance 0.15, tension 0.1.

### 2b. Attention Report

`wiki/attention-report.md` — auto-generated by daemon every morning (or on `flyd attention`):

```markdown
## Attention Report — 2024-06-04

### Top 5 Active Topics
| Topic | Attention | Signals |
|-------|-----------|---------|
| flyd | 0.92 | velocity ↑, surprise ↑, importance ↑ |
| koko | 0.71 | unresolved ↑, tension ↑ |
| smart glasses | 0.23 | velocity ↓, recency ↓ |

### What Changed (last 24h)
- **flyd**: 4 new captures, semantic fallback fixed, 198 tests pass
- **koko**: No new activity. Belief confidence dropped 0.05.

### Unresolved
- **koko funding**: 3 sponsor meetings, all declined or pending
- **smart glasses**: Last mention 45 days ago. Active goal but zero signal.

### Surprising
- New capture mentions "shelving koko" — contradicts active goal.
```

**Cost:** One LLM call per day to generate the natural language report (~500 tokens). Signal computation is all local.

### 2c. Nudge Queue

Attention above threshold (default 0.7) triggers a nudge. Nudges are not notifications — they're entries in `wiki/nudges.md`:

```markdown
## 2024-06-04

- **[koko]** 3 sponsor meetings, all declined. Consider pivoting or lowering threshold.
- **[smart glasses]** Active goal but 45 days of silence. Still committed?
```

The user reviews nudges at their leisure. No push. No interruption.

---

## Phase 3: Tension Engine (medium risk, requires attention layer)

**Problem:** flyd stores facts. Interesting systems store tensions: "goal X, reality Y, gap Z."

**Solution:** `src/lib/tension.ts` monitors goal statements and diff against reality.

### 3a. Goal Detection

Goals are explicit. Three ways to create:

1. **Manual:** `flyd goal "Launch Koko by September"` → creates `goals/launch-koko.md`
2. **Extracted:** Daemon scans captures for goal-like language ("I want to", "plan to", "aim to", "by Q3") and proposes `goals/` pages
3. **Inferred:** LLM reads recent captures and asks "what are you trying to achieve?"

Goal frontmatter:
```yaml
type: goal
deadline: 2024-09-01
status: active        # active | paused | achieved | abandoned
created: 2024-06-01
last_reviewed: 2024-06-04
---
```

### 3b. Reality Tracking

Reality is derived from events:

| Goal | Reality Signal | Source |
|------|----------------|--------|
| Launch Koko | Commits, sponsor meetings, product iterations | GitHub API + captures |
| Grow Good Neighbours | Sponsor count, revenue mentions | captures + manual updates |
| Ship flyd v0.2 | PRs merged, issues closed | GitHub API + captures |

**GitHub integration:** `src/lib/github.ts` (new) fetches commit/PR/issue counts for tracked repos. One API call per tracked repo per day. No LLM cost.

### 3c. Tension Score

For each active goal:

```
tension = f(goal_progress_rate, deadline_pressure, blockers)
```

- `goal_progress_rate` — derived from reality signals (commits, meetings, etc.)
- `deadline_pressure` — days until deadline / expected duration
- `blockers` — count of `outcome: declined` or `signal: blocked` events tagged with goal topic

Tension is 0-1. 
- 0 = on track
- 0.5 = at risk
- 0.8 = blocked
- 1.0 = abandoned

Tension feeds into the attention layer. High tension → high attention → nudge.

### 3d. Tension Report

`wiki/tension-report.md` — generated weekly or on `flyd tension`:

```markdown
## Tension Report — 2024-06-04

| Goal | Deadline | Progress | Tension | Status |
|------|----------|----------|---------|--------|
| Launch Koko | 2024-09-01 | 0.15 | 0.72 | At risk — 3 sponsor declines, 21 days no commits |
| Ship flyd v0.2 | 2024-06-15 | 0.85 | 0.25 | On track — 198 tests, semantic fallback shipped |
| Smart glasses R&D | — | 0.0 | 0.0 | Paused — no deadline, no signal |
```

---

## Phase 4: Curiosity Mode (medium risk, requires tension + attention)

**Problem:** flyd only answers. It never asks.

**Solution:** `src/lib/curiosity.ts` — the daemon generates its own questions based on attention + tension data, then investigates.

### 4a. Question Generation

Every morning, the daemon runs:

1. Read attention report (top 10 topics)
2. Read tension report (all active goals)
3. Generate 3-5 questions:
   - "Koko funding: 3 declines. What changed between the first and third meeting?"
   - "Smart glasses: active goal, 45 days silent. Is this still a priority?"
   - "flyd: 4 captures/day. What are you optimizing for right now?"

**Cost:** One LLM call (~800 tokens) per day.

### 4b. Self-Investigation

For each generated question, the daemon:

1. Runs the same retrieval pipeline as `flyd ask` (keyword + semantic fallback)
2. Reads relevant evidence
3. Generates a partial answer or identifies missing evidence
4. Writes to `wiki/curiosity-log.md`:

```markdown
## 2024-06-04

### Q: What changed between Koko's first and third sponsor meeting?
**Investigated:** events/sponsor-meeting-2024-05-15.md, events/sponsor-meeting-2024-06-01.md
**Finding:** First meeting was exploratory (budget not discussed). Third meeting had explicit budget resistance. Signal shifted from interest to timing.
**Missing:** No follow-up scheduled. Consider re-engaging in Q3.
```

### 4c. User Integration

`flyd curiosity` — shows today's questions and findings.
`flyd curiosity --answer "Q2: yes, still priority"` — user responds to a question, capture becomes a new event.

This closes the loop: daemon asks → user answers → capture stores → attention updates → new questions.

---

## Phase 5: Inner Thought Loop (higher risk, requires all prior phases)

**Problem:** Daemon is event-driven (new capture → process). Not time-driven (observe → reflect → notice → nudge).

**Solution:** Restructure daemon from reactive to proactive loop.

### 5a. Current Daemon (reactive)

```
Event (new capture) → Debounce → Reindex → Link → Interests → Done
```

### 5b. Proposed Daemon (proactive)

```
Every N minutes:
  ├─ Observe: any new captures? If yes, reindex.
  ├─ Reflect: run attention scan on all topics
  ├─ Notice: any tension > threshold? any surprise > threshold?
  ├─ Nudge: write to nudges.md, curiosity-log.md
  └─ Sleep
```

The reactive path still exists (new capture triggers immediate reindex). The proactive path runs on schedule.

### 5c. Schedule

Default: proactive loop every 60 minutes. Configurable.

Per-phase schedule:
- Event extraction: every batch (on new captures)
- Attention scan: every 4 hours
- Tension check: every 24 hours
- Curiosity: every 24 hours (after tension)
- Belief generation: when event cluster threshold reached

### 5d. Budget Cap

`src/lib/budget.ts` (new) tracks daily LLM spend:

```typescript
interface BudgetTracker {
  date: string;
  tokensUsed: number;
  estimatedCost: number;
  calls: { phase: string; tokens: number; cost: number }[];
}
```

Default daily cap: $1.00. Configurable. When cap reached, daemon skips all LLM calls for the day. Pure local processing continues (reindexing, linking, staleness updates).

---

## Implementation Order & Dependencies

```
Phase 1: Event-first memory
  ├─ Schema extension
  ├─ Entity extractor enhancement
  ├─ events/ + beliefs/ folders
  └─ Backfill (user decision)

Phase 2: Attention layer
  ├─ Signal computation (local)
  ├─ Attention report generation (LLM)
  └─ Nudge queue
  └─ **Depends on:** Phase 1 (event types)

Phase 3: Tension engine
  ├─ Goal detection + goals/ folder
  ├─ GitHub reality tracking
  ├─ Tension scoring
  └─ Tension report
  └─ **Depends on:** Phase 2 (attention signals)

Phase 4: Curiosity mode
  ├─ Question generation (LLM)
  ├─ Self-investigation
  └─ Curiosity log
  └─ **Depends on:** Phase 2 + 3

Phase 5: Inner thought loop
  ├─ Daemon restructuring
  ├─ Budget tracker
  └─ Schedule configuration
  └─ **Depends on:** Phase 2 + 3 + 4
```

---

## Success Metrics

After each phase ships:

| Phase | Metric |
|-------|--------|
| P1 | `events/` has pages with `type`, `signal`, `confidence` frontmatter. `beliefs/` has at least 1 auto-generated page. |
| P2 | `flyd attention` generates `wiki/attention-report.md` with 5+ topics scored. Nudges are written, not noisy. |
| P3 | `flyd tension` shows 2+ goals with tension scores. At least 1 goal has tension > 0.5. |
| P4 | `flyd curiosity` shows 3+ questions and 1+ investigation. User can respond. |
| P5 | Daemon runs proactive loop for 7 days without exceeding budget cap. Attention report shows "what changed" accurately. |

---

## Cost Estimate

Assuming gpt-4o-mini at ~$0.15/1M input tokens, ~$0.60/1M output tokens:

| Phase | Daily Cost | Notes |
|-------|-----------|-------|
| P1 (batch backfill) | $5 one-time | 450 captures × ~200 tokens = 90K input tokens |
| P2 (attention) | $0.05 | 1 report × ~800 tokens |
| P3 (tension) | $0.02 | 1 report × ~400 tokens |
| P4 (curiosity) | $0.15 | 5 questions × ~300 tokens + 3 investigations × ~1000 tokens |
| P5 (daemon overhead) | $0.00 | Schedule is free, budget tracker is free |
| **Total daily** | **~$0.22** | Less than a cup of coffee. Backfill is one-time. |

With budget cap at $1.00/day: 4x headroom.

---

## Files to Create/Modify

**New files:**
- `src/lib/schema.ts` — event schema types
- `src/lib/attention.ts` — attention scoring
- `src/lib/tension.ts` — tension engine
- `src/lib/curiosity.ts` — question generation + investigation
- `src/lib/budget.ts` — spend tracking
- `src/lib/github.ts` — commit/PR/issue fetching
- `src/commands/attention.ts` — CLI for attention report
- `src/commands/tension.ts` — CLI for tension report
- `src/commands/curiosity.ts` — CLI for curiosity mode
- `src/commands/goal.ts` — CLI for goal management

**Modified files:**
- `src/lib/entity-extractor.ts` — populate event fields
- `src/lib/decay.ts` — integrate with attention signals
- `src/commands/daemon.ts` — proactive loop, budget check
- `src/index.ts` — register new commands
- `src/lib/config.ts` — proactive flags, budget cap

**New wiki folders:**
- `wiki/events/`
- `wiki/beliefs/`
- `wiki/goals/`
- `wiki/questions/` (for unresolved questions)

---

## Questions for User

Before implementation starts, need decisions on:

1. **Backfill existing captures?** (A) Lazy, (B) Batch, or (C) Hybrid? **Recommendation: B**
2. **GitHub integration?** Do you want the daemon to fetch commit/PR data for tracked repos? Requires `GITHUB_TOKEN`.
3. **Daily budget cap?** Default is $1/day. Too high? Too low?
4. **Nudge delivery?** Nudges go to `wiki/nudges.md` (pull). Would you ever want push (terminal notification, webhook)?
5. **Phase scope?** Should we do all 5 phases at once, or ship Phase 1+2 first, get feedback, then continue?

**Recommendation:** Ship Phase 1+2 first. They're independently valuable. Phase 3-5 build on them but are more speculative. Validate the event-first schema and attention reports feel useful before adding tension/curiosity.
