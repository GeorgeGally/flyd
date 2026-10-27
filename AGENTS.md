# flyd — agent reference

## Repository workflow

- `main` is the working branch and source of truth. Do not leave completed work only on feature/PR branches or temporary worktrees; land it on `main` (fast-forward or otherwise) before reporting completion.
- If local `main` is stale, dirty, or otherwise wrong, preserve any uncommitted work and make `main` match the correct source of truth.

## Product architecture

**Flyd has no primary interface. It has a primary presence.** Flyd = intelligence + harness + interface. Product authority: `docs/product/flyd-personal-intelligence-prd.md` (the only one; other PRDs are subordinate or superseded reference).

- **runtime/** makes Flyd capable (execution, memory, tools, orchestration, Git awareness, coding-agent capabilities); it need not be user-facing.
- **work-intelligence/** makes Flyd a product: the Mac-native manifestation — overlay, voice, scenes, proactive context, interaction.
- **CLI** exposes the runtime for development, debugging and dogfooding — not the destination. Judge every runtime task by: what capability does this unlock or improve in the Mac interface?

Flyd Core is the intelligence runtime in TypeScript (`cli/src/server.ts` + friends). Swift (`mac-adapter/`) is the thin native OS adapter/presence layer: captures environment, renders native UI, handles audio, executes grounded operations.

**Rails is retired** and archived under `legacy/rails/` for history only. Do not add Flyd intelligence, evidence, memory, composition, UI, provider or runtime work there, and do not make active functionality depend on Rails or its PostgreSQL models.

### Adapter modes

| Mode | Trigger | Status | Description |
|------|---------|--------|-------------|
| PRESENT | Always on | Shipped | OS notification-based foreground observation. No cognition, no network, no persistence. |
| INVOKED (text) | Double-tap fn key | Shipped | One-shot text invocation. Intent field → resolution → native/augment/compose. |
| INVOKED (voice) | fn+Ctrl hold (>300ms) | Shipped | Push-to-talk → `gpt-4o-mini-transcribe` transcription after release → Conversation window's message box, sent on release (routed like a typed message) (no `/manifest`, nothing raised or focused). |
| DICTATE | fn tap (toggle) or fn hold | Shipped | Speech → Core cleanup over 4816 (`purpose: dictation`) → pasted into the focused app by `TextInserter`; fn-alone edges are swallowed at the HID tap. |
| LIVE | Ctrl×3 (triple-press) | Shipped | Persistent realtime voice session with `gpt-realtime-2.1`. Tool calling routes through Core safety. Ctrl×3 again to exit. MVP requires headphones. |

Resolution outcomes (Core outcomes, not adapter modes): **Native** (insert/replace in the focused element), **Augment** (explanation/choice/annotation cards), **Compose** (generated Flyd surface; shipped for evidence dossiers through Core — renderer must never be Rails), **Task** (live `task_plan` utterance → tracked canonical `AgentTask` + rendered plan, `requires_task`). All shipped.

Deferred: DELEGATED (legacy envelope) is dormant behind `FLYD_DELEGATION_ENABLED`; `/delegation/complete` returns 501 without it. Live task intake is the supported path.

**Voice is a modality. LIVE is a consciousness/runtime state.**

```text
Swift macOS adapter (thin OS driver)
    ├── PRESENT: NSWorkspace + AXObserver — observation only
    ├── INVOKED text/voice: environment capture → TypeScript Core
    ├── LIVE: audio I/O → LiveAudioBridge → TypeScript Core → OpenAI Realtime
    └── Execution: NativeExecutor (AX refs + fingerprint verification)

TypeScript Core (intelligence, memory, evidence, resolution)
    ├── HTTP :4815 manifest/learnings/health · WS :4816 transcription · WS :4817 realtime + tool relay
    ├── Cognitive Core: event/claim/relation world model → Present/projections → Context Compiler
    ├── System-1: bounded Jev predicates when explicitly enabled; deterministic safety/lifecycle stays authoritative;
    │   every predicate is declared in cognition/system-one/registry.ts and scored by the replay bench before any call site uses it
    ├── Memory: unified cognitive facade; legacy archive retrieval is background evidence
    ├── Evidence Engine → Compose (loopback-only, short-lived evidence dossiers)
    ├── Live task intake: `task_plan` → canonical `AgentTask` + plan
    └── Delegation: legacy intent pattern matching → capability envelope (dormant)
```

### Evidence Engine (`cli/src/evidence/`)

External provider output is evidence supplied to Flyd, never direct UI instructions. Pipeline: CapabilityAdapter → CapabilityRegistry health + ordered fallback → intent-aware quick/default/deep planning → retrieval + provenance + weighted fusion → clusters + contradictions + coverage gaps → EvidenceBundle → Core reasoning → augment or Core-owned dossier. Design and E0–E5 sequence: `docs/product/flyd-evidence-engine-prd.md`.

- Capabilities: `web.read`/`web.search` (Jina; `JINA_API_KEY`), `github.read/search` (`GITHUB_TOKEN`/`GH_TOKEN` optional), `rss.read` (native), `youtube.read/search` (`yt-dlp`), `hackernews.read/search` (anonymous), `reddit.read/search` (public JSON degraded; optional `REDDIT_ACCESS_TOKEN`), `x.read/search` (needs `X_BEARER_TOKEN`/`TWITTER_BEARER_TOKEN`).
- E2 enriches INVOKED and LIVE questions that materially depend on current external facts; stable writing and personal recall do not browse. Required current claims fail closed when evidence cannot be retrieved.
- E4 deep research is bounded: weighted primary/official/community/limitations/alternatives/recent lenses, then at most one two-query drill-down round. Explicit deep-research requests produce a short-lived dossier on loopback port 4820 (Flyd's own, beside 4815–4819; never 3000) — a transport compatibility point for the Mac adapter, served by TypeScript Core, never Rails.
- PRESENT stays zero-network; external evidence is not automatically written into personal memory.

### Connectors and other presences

- **Email/Drive** (`cli/src/connectors/`, `flyd accounts`; `docs/product/flyd-email-drive-setup.md`): direct Google APIs + DreamHost IMAP via personal tools and the explicit account-intent path in `resolve.ts` (also LIVE). Drafts and new Docs only; no send/delete/share tools.
- **WhatsApp** (`cli/src/connectors/whatsapp*.ts`; `docs/product/flyd-whatsapp-setup.md`): the People artefact (`conversation-view/whatsapp-page.ts`, `/whatsapp`) owns inbox/thread/reply review; Core owns the linked-device socket, other processes use its authenticated loopback API. Outward sends use immutable reviewed drafts, atomically claimed once; uncertain sends never retry.
- **Mobile** (`flyd mobile serve|pair|revoke`, `cli/src/mobile/`, private port 4819; `docs/product/flyd-mobile-setup.md`): server-native web adapter reusing the conversation runtime with an enforced mobile capability ceiling, canonical request receipts and separate browser session auth. No Mac bridge/schedulers or automatic state migration. Never expose the loopback desktop view/Core as a shortcut.
- **Routine artefacts** (`docs/product/flyd-routine-artefacts.md`): repeated conversation-view requests can suggest reusable artefacts; Preferences → Routines owns editing, inputs and run history. Runs use the canonical event spine and source router and never confer permissions.
- For all connectors: credentials stay private/local, outside repositories and model tools; retrieved content is untrusted evidence, never automatic memory.

### Privacy invariants

11 falsifiable constraints live in `mac-adapter/Sources/Privacy/PrivacyInvariants.swift`: no screenshots in PRESENT, no environment persistence after invocation, no raw audio storage, mic only during explicit user action, among others.

### Guardrails

- Do not introduce project-first or conversation-first primary navigation.
- Do not make stored records visible merely because they exist.
- Do not introduce Rails as an active runtime, composition, evidence, provider, or memory dependency.
- Provider output is evidence supplied to Flyd, never direct UI instructions.
- The Swift adapter never decides what to do; intelligence routes through TypeScript Core.
- PRESENT must remain zero-network and zero-persistence.
- External credentials must be scoped to the adapter that needs them.
- Do not automate logged-in social sites or mutate social accounts through evidence adapters.
- Do not treat engagement or popularity as truth.
- Do not persist raw external evidence into personal memory without a separate governed decision.
- Deep research must remain bounded; no recursive browsing loop without a hard cap.
- Chat autonomy (`cli/src/runtime/tool-policy.ts`, `FLYD_AUTONOMY=full|trusted|ask`, default trusted): local, reversible work runs without asking; push/publish/send/delete/pipe-to-shell ask George (answer `a` = always this session); after web content enters a turn, shell/AppleScript/scheduling ask too. `read_url` is public-web only (`url-guard.ts`); fetched code is scanned (`code-audit.ts`). George wants Flyd powerful — don't add new approval gates without asking him.
- Command hierarchy (`cli/src/command/`; `docs/product/flyd-command-architecture-prd.md`): Flyd owns George's intent, cross-domain priority, escalation and retained results; domain bosses own their domain outcome and delegate execution. FirstMate owns coding via its durable inbox/reply API; Librarian owns substantial knowledge work (Retriever/Researcher/Fact Checker jobs); design is a team (`command/design-mate.ts`): the Creative Director takes Flyd's brief, sets the directions, judges from screenshots only (≤3 rounds) and presents to Flyd; Design Mate is the producer running Designers and files; Flyd accepts, asks for changes or rejects (≤2 send-backs) before anything reaches George. Labs live in `~/.flyd/labs/<id>/` and are done only when every page and shot is on disk; a picked version (a lab follow-up naming it) is built for real by a Designer editing George's own project copy, reviewed the same way, and committed by Design Mate (only the files it changed). Handoffs retain George's original wording plus layered results (brief → report → specialist outputs/evidence/raw); summaries never become the sole surviving truth. Routing/handoff failures feed the existing governed self-improvement loop, not a second learner.
- One voice: George only ever talks to Flyd. Council, Scout, crew and self-improvement are backstage — never label user-facing text (chat, greeting, notifications) with their names. Voice comes from `~/.flyd/SOUL.md` (default `cli/src/lib/soul.ts`).
- Chat turns: companion prompt mode stays lean (small models lose EQ under long rule lists); the operator rulebook + repo evidence are only for code/work-state turns, and naming a project is not a work turn. Read-the-room (`cli/src/runtime/read-the-room.ts`) picks the route; the harness enforces it (`cli/src/runtime/turn-plan.ts`) — fix wrong-kind-of-turn failures there, not with another prompt rule. Investigator findings go to MEMORY.md, never USER.md. Details: `docs/product/flyd-backstage.md`.

## Structure

Start with `mac-adapter/` and `cli/src/server.ts` for the active product.

```text
flyd/
  mac-adapter/                 Swift Mac presence layer (Makefile = supported build/install/run path; Sources/)
  cli/                         TypeScript Core
    src/server.ts              Core HTTP + WS runtime
    src/resolve.ts             manifest → resolution
    src/transcription.ts       invoked voice transcription relay
    src/realtime-session.ts    LIVE realtime relay
    src/cognition/             context compiler, Present materialization, curator, projections, Jev System-1
    src/evidence/              external evidence, deep research and compose layer
    src/lib/                   memory, retrieval, currentness and shared intelligence logic
    src/runtime/               harness: execution, tools, orchestration, coding-agent capabilities (flyd CLI)
    src/work/                  shared Present Model substrate and work-index (SQLite)
    src/work-intelligence/     ground/diagnose/intervene, jobs, skillify, repository action
    src/council/, src/crew/, src/command/   backstage processes and command layer
  docs/product/                PRDs and feature references
  docs/solutions/              documented engineering solutions (YAML frontmatter); search before implementing or debugging in documented areas
  CONCEPTS.md                  shared domain vocabulary
  legacy/rails/                retired Rails tree — history only; do not extend
```

## Commands

```bash
cd mac-adapter && make run           # build, sign, install, launch
cd cli && npm run core               # run Flyd Core only
cd cli && npm test                   # CLI/Core tests
cd cli && npm run lint               # TypeScript typecheck
cd cli && npm run build
cd cli && npm run dev -- doctor      # evidence capability diagnostics during development
cd cli && npm run evals:chat         # live chat evals (read-only; --only id,id --model provider:model; LLM-judged via FLYD_EVAL_JUDGE_MODEL; ~/.flyd/evals/chat/). Pick chat models with this, not by reputation
flyd doctor [--json]                 # installed CLI diagnostics incl. live chat-model failover chain probe
flyd evidence research "topic" [--deep] [--json]
flyd agenda [list|add|cancel|inbox|run-due|install]           # proactive agenda          → docs/product/flyd-backstage.md
flyd council [status|run [--all]|advisories|investigate|backfill]  # memory/projects curation → docs/product/flyd-backstage.md
flyd scout [show|run|watch|evolve|more N|less N|sources|taste]     # personal news          → docs/product/flyd-backstage.md
flyd crew [list|dispatch <outcome> [--done <point>]…|show|supervise|land|discard]  # crewmates; only fully-checked self-improvement fixes land themselves, all else waits for George's /land → flyd-backstage.md
flyd improve [status|evidence|run|routing-import|routing-audit|routing-evaluate]  # governed self-improvement → docs/product/flyd-routing-learning.md
flyd profile [edit|bootstrap]        # George's USER.md: explicit edits, confirmed bootstrap, `/onboard`; automatic extraction never writes USER.md; historical entries preserved
flyd learning [--approve|--reject <n>]  # dictation corrections → docs/product/flyd-contextual-voice-learning.md
flyd view [--session id] [--project dir]  # conversation view on 127.0.0.1:4818 → docs/product/flyd-conversation-view.md
flyd taste [show|for <project|path>|learn [--days N]|curate|skills|edit]  # learned design/code taste → docs/product/flyd-taste.md
flyd transitions                     # recent transitions/judgments/directives; --export <sourceId>, --forget <sourceId>
FLYD_CHAT_FALLBACK_MODELS=openai:gpt-5.6-luna  # chat/ask failover after Claude (while under its monthly cap) and FLYD_CHAT_MODEL; provider-qualified openai:|anthropic:|commandcode:|opencode-go:; every model override: docs/product/flyd-models.md
FLYD_TRANSITIONS_DISABLED=1          # kill switch for all transition capture
FLYD_JEV_MODEL=jev-1.13.0            # pin an exact Jev release (default jev-latest); thresholds were tuned against the pinned one
FLYD_JEV_EVAL=1 TYPESAFE_API_KEY=… FLYD_JEV_EVAL_RECORD=/tmp/r.jsonl npm run evals   # live System-1 replay (synthetic fixtures only); freeze as src/evals/fixtures/system-one/recordings.jsonl
```

Kill switches: `FLYD_COUNCIL=0`, `FLYD_MUSE=0`, `FLYD_SELF_IMPROVE=0`, `FLYD_TASTE_LEARNING=0`, `FLYD_TASTE_SKILLS=0`, `FLYD_VIEW_SUMMARIES=0`. Tests must never launch a real crewmate (guarded under VITEST) or touch the real firstmate home (`cli/src/lib/firstmate-home.ts`).

> **CLI uses compiled `dist/`, not source.** The `flyd` CLI is the global npm symlink into `cli/dist/index.js`. Edits under `cli/src/` are not live until `cd cli && npm run build`; rebuild after verifying with `npm test` before claiming a CLI fix is live. `make install`/`make run` rebuild `dist/` (installing missing dependencies first); a plain `git pull` does not.

Legacy Rails commands (run from `legacy/rails/`) are not part of the active workflow.

## Key files

- `docs/product/flyd-personal-intelligence-prd.md` — **the single product authority** (personal intelligence, LEARN consent plane, event runtime, action authority, policy promotion)
- `docs/product/flyd-work-intelligence-prd.md`, `flyd-overlay-prd.md` — superseded; detailed reference for the overlay work loop and interaction model
- `docs/product/flyd-evidence-engine-prd.md` (+ `-e1.md`, `-e3-e4.md`) — evidence/reach architecture and implementation decisions
- `mac-adapter/Sources/main.swift` — app entry point and invocation lifecycle
- `mac-adapter/Sources/UI/InvocationPanel.swift`, `AugmentPanel.swift` — command bar and augment UI
- `mac-adapter/Sources/Capture/VoiceCapture.swift` — mic capture / spectrum
- `mac-adapter/Sources/Bridge/FlydClient.swift`, `VoiceTranscriptionRelay.swift`, `LiveAudioBridge.swift` — `/manifest`, 4816 and 4817 clients
- `mac-adapter/Sources/Execution/ObservedTarget.swift` — LIVE execution grounding
- `mac-adapter/Sources/Auth/AdapterAuth.swift` — shared Core/adapter bearer token
- `cli/src/server.ts`, `resolve.ts`, `realtime-session.ts` — Core runtime, resolution, LIVE relay
- `cli/src/evidence/` — `types.ts` (contracts), `capability-registry.ts`, `evidence-engine.ts`, `default-registry.ts`, `clustering.ts`, `contradictions.ts`, `compose-surface.ts`, `doctor.ts`
- `cli/src/lib/brain-retrieval.ts` — shared personal-memory evidence retrieval

## Overlay gotchas

### JSON key format — Core sends camelCase, Swift must match

Core uses `JSON.stringify(body)` (camelCase). The Swift decoder in `FlydClient.post()` must NOT use `.convertFromSnakeCase`; response properties match JS keys directly. Manifest request structs DO use explicit snake_case `CodingKeys` (`invocationId = "invocation_id"`); the encoder does not use `.convertToSnakeCase` — CodingKeys are authoritative.

### Main thread safety

`handleInvocation()` and `handleVoiceInvocation()` create `Task { await processInvocation(...) }`. AppKit work inside `processInvocation` must run on the main actor:

```swift
await MainActor.run {
    invocationPanel.dismiss()
    state.transition(to: .present)
}
```

`state.cancelInvocation()` / state-machine cancellation are thread-safe. `NSPanel`, `NSTextField` and other AppKit calls are not.

### No deadline task

Do not add a separate invocation deadline task. A prior 10-second deadline cancelled in-flight URLSession requests, turning slow responses into `NSURLErrorCancelled (-999)`. `FlydClient.post()` owns the network timeout.

### AugmentPanel

- All cards accept mouse events so answer text can be selected and copied; interactive `choice`/`control` cards also have draggable backgrounds and option buttons.
- Every card shows ✕; Escape also dismisses. No click-outside dismiss and no auto-dismiss timer — a card stays until ✕, Escape or an option choice.
- Clamp card layout to `screen.visibleFrame`.
- Multiple augmentations need separate `AugmentPanel` instances; reusing one silently drops previous cards because `.show()` begins with `dismiss()`.

### Resolution routing

General questions must resolve to `requires_augment`, not insert answers into the focused element. `buildResolutionPrompt()` in `resolve.ts` carries this rule and the distinct native/augment/compose response shapes. Exception: explicit deep-research intents — E4 prepares a Core-owned dossier and the model returns `requires_compose`; if the loopback renderer cannot start, the evidence layer downgrades to a detailed augment rather than returning a dead compose URL.

### Build & install cycle

`make -C mac-adapter install` kills the old Core process; reopen `~/Applications/Flyd.app` and the adapter auto-launches Core. Do not run `xcodebuild` directly from Terminal for normal testing (it can invalidate TCC permission attribution); use `make run` or `make install`.

## Known issues

- Local dev signing can require re-granting Accessibility/Input Monitoring/Screen Recording/Microphone after rebuilds.
- Without `FLYD_MODEL_API_KEY` in `cli/.env`, model-backed resolution cannot answer normally (Core configuration issue).
- GUI-launched processes inherit a minimal `PATH` and may start with `/` as the working directory. Never assume Homebrew/nvm/local bin paths; native startup must resolve them explicitly.
- Launching the raw adapter binary from Terminal can make macOS attribute TCC checks to the wrong process; test with `make run`.
- The TypeScript baseline has unrelated pre-existing type errors in older memory/graph tests/files; don't attribute them to new evidence code unless an error points into `cli/src/evidence/`.
- Legacy Rails CI/schema failures are noise and must not drive active Flyd architecture decisions.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session. Do not repeat what the code or docs already show; point to the authoritative file instead (feature detail belongs in `docs/product/`). Prefer rewriting or pruning entries over appending. Keep entries concise.
