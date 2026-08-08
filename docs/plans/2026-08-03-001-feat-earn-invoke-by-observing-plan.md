---
title: Earn Invoke by Observing First - Plan
type: feat
date: 2026-08-03
origin: docs/ideation/2026-08-03-one-intelligence-two-modalities-ideation.md
related: docs/plans/2026-08-02-001-feat-work-intelligence-loop-plan.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# Earn Invoke by Observing First - Plan

## Goal Capsule

Make Flyd worth invoking by giving it continuous **observation** and **readiness** before cognition. One intelligence serves two modalities (Mac overlay + CLI). It looks at git and agent conversations, binds to the live project, refuses to invent when evidence is thin, and answers from the same retrieval and learning gate on both surfaces.

**Not in this plan:** background intervention, attention autonomy, gateways, messaging, or a second brain.

Authority order:

1. Live project binding (foreground document / CLI session root + git digest).
2. This plan's product contract and the ideation spine.
3. Work-intelligence plan for Mac Ground→Diagnose→Intervene (complement, do not fork).
4. `STRATEGY.md` and existing Core/memory patterns.

Stop and surface a blocker if:

- observation would persist raw screenshots, full unredacted transcripts into prompts, or secrets;
- “background” work becomes autonomous interruption or standing agent loops;
- CLI and Mac diverge again into separate retrieval/learning stacks;
- project identity is still taken from Core `process.cwd()`.

## Product Contract

### Problem

Flyd is open as an app but idle as intelligence. PRESENT does not feed the brain. Useful work waits for invoke. Invoke is often wrong-project, empty-memory, or general-knowledge slop — so invoke never becomes a habit. Weeks of CleanX/Flyd work in git, Cursor, and Codex never enter `~/.flyd`.

### Outcome

After this plan:

- Asking “what am I working on?” / “what’s left on CleanX?” from **Mac or CLI** cites live git and/or distilled session evidence for the **resolved** project — or honestly says evidence is missing.
- CLI chat no longer freestyles personal/project answers from general knowledge.
- Mac and CLI share one project model builder, one retrieval entrypoint, one refuse policy.
- Observation runs without requiring an invoke; it never interrupts.

### Requirements

#### Observation (earn the invoke)

- R1. Maintain a local **project registry** of known repo roots (at least CleanX + Flyd initially; discoverable from git remotes / configured paths).
- R2. A **git observer** periodically (or on demand + daemon tick) writes a bounded project-tagged digest into `~/.flyd/raw/` (branch, HEAD, dirty summary, last N commit subjects). Idempotent; no full diffs by default.
- R3. **Conversation importers** distill Cursor agent transcripts, Codex session jsonl, and OpenCode session/distill sources into `~/.flyd/raw/` with `project:`, `source:`, and `epistemic` observation-class frontmatter. Distill decisions/open loops — do not dump full chats into answer prompts.
- R4. New captures are QMD-indexed (`flyd-raw`) so `ask`, CLI, and Mac Memory Pack can hit them. `cache/notes` is non-authoritative until copied/promoted into indexed raw.

#### Binding (correct world)

- R5. `buildPresentModel` and Current Work grounding take an **explicit project root**, never Core `process.cwd()` as authority.
- R6. Mac passes resolved foreground root (document path → nearest git root). CLI passes session root or terminal cwd only as the *modality-supplied* root, labeled as such.
- R7. Archival memory cannot rename the live project. Live git/session evidence outranks wiki for current-state claims (aligns work-intel R2/AE1).

#### Refuse (anti-slop)

- R8. Personal/project/current-state questions use a shared **evidence sufficiency** check. Insufficient → refuse + name the gap; never “use general knowledge when personal evidence is absent.”
- R9. CLI conversation and Mac Memory Pack / ask share the same sufficiency policy for those question classes. Pure world-knowledge questions may still use general knowledge.

#### Unify (one intelligence, two modalities)

- R10. One TypeScript module owns: project root resolution helpers, present-model build, present-tense pack assembly, brain retrieval call, refuse decision. Mac Core and CLI REPL both call it.
- R11. CLI chat stops using keyword-only fast retrieval as its primary memory path for project/personal questions; it uses the shared brain retrieval (budget may differ).
- R12. Work Session continuity remains Mac-primary for work-intel; CLI may attach later. This plan does **not** require full Work Session parity on day one — it requires shared **project model + retrieval + refuse**.

#### Learning (selective, later in sequence)

- R13. Observation writes are always `observation` / `promoted: false` until an existing selective gate promotes them.
- R14. Do not auto-promote conversation residue into wiki/canon.

### Key Decisions

- K1. **Observe ≠ intervene.** Background = index/digest only. No proactive UI from this plan.
- K2. **Complement work-intel, don’t absorb it.** U2 live root + U7 selective learn stay owned by work-intel; this plan feeds them better evidence and fixes CLI/ask present-model cwd.
- K3. **Phase importers.** Ship git observer + refuse + shared present-model first; then Codex; then Cursor; then OpenCode distill→raw pipe.
- K4. **Attention engine stays out.** No imports from `cli/src/attention/**` into this path.
- K5. **Privacy:** store distill summaries + provenance paths/ids, not full secret-bearing tool payloads. Redact obvious secrets. No screenshots in observer output.

### Success Criteria (founder-checkable)

1. With Core running from `flyd/cli` and focus/session on CleanX, both Mac invoke and CLI chat name CleanX as current project (or unknown) — never Flyd-as-current.
2. After git observer runs on CleanX, `flyd ask "recent CleanX work"` cites commit subjects from raw evidence.
3. After Codex/Cursor importer runs for CleanX, ask/CLI can cite at least one distilled decision/open loop — or report no sessions found (honest).
4. CLI chat asked a personal/project question with empty evidence refuses invention (no milestone-list slop).
5. Same query via CLI chat and `flyd ask` shares top evidence paths within budget truncation.
6. Dependency scan: observer/retrieval unify path does not import attention, Rails bridge, or legacy orchestrator.

## Relationship to Work Intelligence

| This plan | Work-intel plan |
|-----------|-----------------|
| Fills the archive + present pack so invoke is informed | Makes the Mac invoke loop Ground→…→Learn |
| Fixes CLI dumb path | Mac product boundary for founder trial |
| Shared present-model root | U2 foreground capture → root |
| Refuse slop on both surfaces | U3 diagnosis quality |
| Observation candidates | U7 promotion |

Implement in parallel where files don’t collide; prefer landing **U0–U2 of this plan** before expecting work-intel founder trial to feel “smart about CleanX.”

## Implementation Units

### U0. Shared project root + Present Model without cwd authority

**Goal:** Make every current-state path take an explicit root.

**Requirements:** R5–R7.

**Files:**

- `cli/src/lib/present-model.ts`
- `cli/src/lib/brain-retrieval.ts`
- `cli/src/work-intelligence/current-work.ts` (align; don’t fork)
- `cli/src/runtime/repository-inspector.ts`
- `cli/src/lib/__tests__/present-model.test.ts`
- `cli/src/lib/__tests__/brain-retrieval-commits.test.ts`
- `cli/src/__tests__/current-work.test.ts`

**Approach:**

- Change `buildPresentModel(root: string | null, …)` — null means no repository corroboration (gap), not `process.cwd()`.
- Thread root from ask (CLI cwd as *session* root), from Mac (resolved document root), from work-intel Current Work.
- Add fixture: Core process cwd = flyd/cli, supplied root = CleanX → present model is CleanX.

**Verification:** Unit tests for cwd non-authority; ask current-state with mocked root.

---

### U1. Refuse hatch + shared sufficiency

**Goal:** Stop personal/project slop on CLI; align Mac/ask.

**Requirements:** R8–R9, R11 (partial).

**Files:**

- `cli/src/runtime/conversation-responder.ts`
- `cli/src/lib/evidence-sufficiency.ts` (new)
- `cli/src/commands/ask.ts` (prompt alignment if needed)
- `cli/src/resolve.ts` (MemoryPack gaps → refuse posture in prompt)
- `cli/src/runtime/__tests__/conversation-responder.test.ts` (new/extend)
- `cli/src/lib/__tests__/evidence-sufficiency.test.ts` (new)

**Approach:**

- Classify question: `personal_or_project` vs `world_knowledge`.
- For `personal_or_project`: if present pack + brain matches insufficient → fixed refuse template (gap + one sharp question). Remove escape-hatch sentence from system prompt.
- Horoscope-style missing-fact path remains as a special case of the same pattern.

**Verification:** Empty-memory CleanX question on CLI returns refuse, not milestone list. World-knowledge “what is HTTP” still answers.

---

### U2. Present-tense pack

**Goal:** Compile live clock for current-state questions.

**Requirements:** R2 (consume), R6–R7, R10.

**Files:**

- `cli/src/lib/present-tense-pack.ts` (new)
- `cli/src/lib/present-model.ts`
- `cli/src/runtime/conversation-responder.ts`
- `cli/src/resolve.ts` / MemoryPack assembly
- `cli/src/commands/ask.ts`
- tests for pack assembly

**Approach:**

- Pack fields: project name/root, branch, HEAD short, dirty flag, last ≤5 commit subjects, optional last session distill excerpt (if any), optional last Work Session objective if store available.
- Inject into CLI conversation + ask + Mac MemoryPack `current` lane for current-state / project questions only.
- Cap size for overlay latency.

**Verification:** Dirty CleanX + stale Flyd wiki → pack names CleanX; wiki not presented as current.

---

### U3. Git observer → raw

**Goal:** Continuous (or tick/on-demand) git digests into the archive.

**Requirements:** R1–R2, R4, R13.

**Files:**

- `cli/src/observe/project-registry.ts` (new)
- `cli/src/observe/git-observer.ts` (new)
- `cli/src/commands/observe.ts` (new CLI: `flyd observe` / `flyd observe --once`)
- Wire optional tick from existing `daemon.ts` if present and safe
- `cli/src/observe/__tests__/git-observer.test.ts`

**Approach:**

- Registry file under `~/.flyd/config/projects.json` (or extend config.json) listing roots; bootstrap with CleanX + Flyd if paths exist.
- Write `raw/observe-git-<project>-<date>.md` with frontmatter `type: project`, `source: git-observer`, `promoted: false`, bounded body.
- Dedup: skip write if HEAD+dirty digest unchanged since last observe for that root.
- Index via existing raw update path.

**Verification:** Run observe on CleanX; `flyd ask` retrieves new raw; no write when unchanged.

---

### U4. Conversation importers (phased)

**Goal:** Distill agent sessions into observation captures.

**Requirements:** R3–R4, R13–R14.

**Files:**

- `cli/src/observe/codex-importer.ts` (new)
- `cli/src/observe/cursor-importer.ts` (new)
- `cli/src/observe/opencode-distill-pipe.ts` (new)
- `cli/src/observe/session-distill.ts` (new — shared distill shape)
- `cli/src/commands/observe.ts` (subcommands)
- tests with fixture jsonl snippets

**Approach:**

- **Phase A — Codex:** scan `~/.codex/sessions/**/*.jsonl`, map to project via cwd/path in session if present else registry heuristics; distill user goals + assistant decisions + open questions (LLM or heuristic extract; prefer cheap heuristic first, LLM optional behind flag).
- **Phase B — Cursor:** scan `~/.cursor/projects/*/agent-transcripts/**/*.jsonl`; project from folder slug (`Documents-cleanx` → cleanx).
- **Phase C — OpenCode:** copy/promote `cache/notes/*.md` and/or session storage into indexed raw with observation class; stop leaving distills invisible to QMD.
- Idempotent by session id. Never mark canon.

**Verification:** Import one known CleanX Codex or Cursor session; ask returns cited distill. Full dump never appears as the answer body.

---

### U5. Unify CLI chat onto shared retrieval

**Goal:** CLI REPL uses the same brain path as ask (budgeted).

**Requirements:** R10–R12.

**Files:**

- `cli/src/commands/code.ts` (`retrieveAgentMemory`)
- `cli/src/runtime/agent-session.ts`
- `cli/src/runtime/fast-brain-retrieval.ts` (demote to fallback only)
- `cli/src/lib/brain-retrieval.ts`
- tests for agent memory merge

**Approach:**

- `retrieveAgentMemory` calls shared brain retrieval + present-tense pack for project/personal queries; keep conversation-memory merge; shared Rails DB remains soft-fail optional.
- Fast keyword scan only if brain retrieval unavailable (timeout/error), and sufficiency still applies (prefer refuse over slop).

**Verification:** Same CleanX question via `flyd` chat and `flyd ask` shares evidence paths; chat no longer invents with empty store.

---

### U6. Selective learning alignment (thin)

**Goal:** Ensure observers cannot accidentally canonize.

**Requirements:** R13–R14.

**Files:**

- `cli/src/memory-gate.ts` (document interaction)
- observer frontmatter schema
- optional: promote path only via existing gate / work-intel U7

**Approach:**

- Contract test: observe-written files always `promoted: false` / observation epistemic.
- No new promote automation in this plan beyond preserving invariants.

**Verification:** After a week of observe ticks, wiki canon count for CleanX does not explode from auto-promotion.

## Sequencing

```
U0 present-model root
 → U1 refuse hatch
 → U2 present-tense pack
 → U3 git observer
 → U5 CLI unify retrieval   (can overlap late U3)
 → U4 conversation importers (Codex → Cursor → OpenCode)
 → U6 learning alignment check
```

Do **not** wait for full U4 before claiming U0–U3+U1 success — git alone already makes CleanX “visible.”

## Out of Scope

- Attention engine, proactive notifications, LIVE escalate runners
- Bulk embedding of entire transcript corpora into prompts
- Multi-user sync, cloud memory, MCP marketplace
- Replacing work-intelligence Mac loop
- Making CLI the primary product surface

## Verification Contract

### Fast gates

- `cd cli && npm test -- present-model evidence-sufficiency present-tense-pack git-observer`
- `cd cli && npm run lint`
- Manual: `flyd observe --once` then `flyd ask "what is current on CleanX?"`

### Founder gates

- Criteria 1–6 in Success Criteria above, exercised on real CleanX + Flyd checkouts.
- Installed Mac invoke (via `make run`) with CleanX foreground: current project correct; no Flyd false current.
- CLI chat: empty-evidence personal question refuses; post-observe question cites evidence.

## Definition of Done

- R1–R14 implemented or explicitly deferred with owner note (only R3 phases B/C may defer).
- U0–U3, U1, U5 land on `main` with tests green.
- At least one real CleanX git digest and one real session distill retrievable via ask and CLI.
- Escape-hatch sentence gone from conversation system prompt.
- Attention/orchestration not imported.
- Ideation spine status updated; work-intel plan remains authoritative for Mac GDI loop.
