---
date: 2026-08-03
topic: one-intelligence-two-modalities
focus: Earn invoke by observing first — one intelligence, two modalities; git + agent conversations as evidence
mode: repo-grounded
---

# Ideation: One Intelligence / Two Modalities

## Grounding Context

Flyd is Mac overlay (Swift) + TypeScript Core, with a legacy Rails/coding harness. In practice there are multiple intelligences: CLI chat (keyword + general-knowledge escape hatch), `flyd ask` (QMD brain), Mac Memory Pack. CleanX weeks of work are absent from `~/.flyd`; Codex (~744 sessions) and Cursor transcripts are unread; OpenCode distills sit in `cache/notes` outside QMD. Present Model defaults to `process.cwd()`. Work-intelligence loop plan covers Mac Ground→Diagnose→Intervene but freezes background autonomy. Strategy: Mac-native work intelligence, not a general agent platform.

**Deadlock (founder insight):** Flyd is open as an app but not working as intelligence in the background. It waits to be invoked, yet is not useful enough to be worth invoking — cold start forever. Unlock is background *observation* and *readiness*, not background *intervention*.

## Topic Axes

1. shared-core-surfaces
2. project-currentness
3. conversation-observation
4. retrieval-anti-slop
5. selective-learning

## Ranked Ideas

### 1. CLI is a modality — one Core depth pipe
**Description:** Mac and CLI are two clients of one Core: same retrieval, present-model, learning gate. Kill chat-shallow vs ask-deep.
**Axis:** shared-core-surfaces
**Basis:** `direct:` conversation-responder escape hatch; dual retrieval stacks
**Rationale:** Without this, every other fix forks again.
**Downsides:** Touches CLI harness identity
**Confidence:** 90%
**Complexity:** Medium–High
**Status:** Explored → implementation plan

### 2. Live project binding — kill cwd authority
**Description:** Project = live binding from foreground/session root; git corroborates; archive cannot rename current.
**Axis:** project-currentness
**Basis:** `direct:` present-model cwd default; work-intel AE1
**Rationale:** Wrong project poisons all downstream judgment.
**Downsides:** Non-git work needs honest unknown
**Confidence:** 95%
**Complexity:** Medium
**Status:** Explored → implementation plan

### 3. Observe git + agent conversations into the archive
**Description:** Read-only observers distill git + Cursor/Codex/OpenCode into `~/.flyd/raw` with project + provenance. Observation ≠ knowledge.
**Axis:** conversation-observation
**Basis:** `direct:` CleanX absent; `external:` sessiongrep/Memgentic
**Rationale:** Flyd “doesn’t remember” because it never saw.
**Downsides:** Privacy/volume; must distill not dump
**Confidence:** 88%
**Complexity:** High (phased)
**Status:** Explored → implementation plan

### 4. One retrieval contract + refuse when evidence absent
**Description:** Shared brain-retrieval; personal/project questions refuse without evidence; delete general-knowledge escape hatch.
**Axis:** retrieval-anti-slop
**Basis:** `direct:` escape-hatch line; SecondBrain citation gate
**Rationale:** Slop destroys invoke habit.
**Downsides:** Feels thinner until observation fills archive
**Confidence:** 92%
**Complexity:** Low–Medium
**Status:** Explored → implementation plan

### 5. One selective learning gate — outcomes not residue
**Description:** One Core promote policy; distills as candidates; forget routine success.
**Axis:** selective-learning
**Basis:** `direct:` R19/U7; memory-gate
**Rationale:** Observation without selection becomes landfill.
**Downsides:** Less chat continuity theater
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored (phase after observe)

### 6. Present-tense pack — git + sessions as the clock
**Description:** Bounded pack of resolved-root git + recent session distill + last Work Session objective for current-state questions on both surfaces.
**Axis:** project-currentness
**Basis:** `direct:` R2; Sentinel/SecondBrain packs
**Rationale:** Current-state is present-tense; wiki is often past.
**Downsides:** Needs root resolution; keep pack small for latency
**Confidence:** 80%
**Complexity:** Medium
**Status:** Explored → implementation plan

## Spine

**Earn invoke by observing first:** observe (#3) → bind (#2) → refuse (#4) → unify (#1) → present pack (#6) → selective learn (#5).

Not in V1 of this spine: background intervention / attention engine autonomy.

## Rejection Summary

| Idea | Reason |
|------|--------|
| PRESENT+ attention bus | Post-gate; freezes background autonomy |
| CLI-primary dogfood | Conflicts with Mac product boundary |
| Zero-LLM Ground / Ack-first | Orthogonal to unification |
| Multi-project twin / k8s readiness metaphors | Subsumed by live binding + present pack |
| Formulary/accession metaphors | Folded into observe + selective learn |
