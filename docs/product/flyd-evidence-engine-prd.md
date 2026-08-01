# Flyd Evidence Engine PRD

## Status

**E0, E1 and E2 implemented.** This document defines the external-evidence and capability architecture for the active Flyd product.

It merges the strongest architectural ideas from:

- **Agent Reach:** provider-independent capabilities, ordered backend fallbacks, live health probing, explicit setup/credential state.
- **last30days:** intent-aware research planning, source semantics, parallel retrieval, provenance, freshness/engagement-aware ranking, reciprocal-rank fusion, diversity controls, clustering and evidence-first synthesis.

Flyd does **not** adopt either project as the intelligence layer. Flyd Core remains the authority. External tools supply evidence; Flyd decides what the evidence means and how to manifest the result.

---

## Product thesis

Flyd has four strong primitives:

1. **Local world** — the Mac environment visible at invocation time.
2. **Personal world** — memory, projects, preferences, beliefs and recent work.
3. **External world** — health-aware access to current public information.
4. **Manifestation** — native actions, augmentations, composed surfaces and later delegation.

The Evidence Engine is the adjudication layer between perception and reasoning. It decides:

- whether live external evidence is required,
- which source types are epistemically appropriate,
- which concrete backend is currently healthy,
- how results from different sources should be fused,
- which evidence is actually current,
- what provenance supports a claim,
- when evidence is insufficient or contradictory.

**Flyd treats external information the same way it treats memory currentness: as evidence that must be selected, ranked, corroborated and bounded before it influences an answer.**

---

## Core architecture

```text
                         FLYD CORE
                            │
                 INTELLIGENCE / DIRECTOR
                            │
          ┌─────────────────┼─────────────────┐
          ↓                 ↓                 ↓
      PERSONAL           LOCAL            EXTERNAL
       WORLD             WORLD             WORLD
          │                 │                 │
       Memory           Mac state       Capability layer
       beliefs          screen          web / GitHub / X
       projects         AX              Reddit / YouTube
       history          files           RSS / HN / etc.
          │                 │                 │
          └─────────────────┼─────────────────┘
                            ↓
                     EVIDENCE ENGINE
                            │
                 classify evidence need
                 plan research
                 select healthy backends
                 retrieve in parallel
                 normalize + provenance
                 rank + fuse + diversify
                 currentness + corroboration
                 conflicts + gaps
                            ↓
                       REASONING
                            ↓
          native / augment / compose / delegate
```

The Evidence Engine is a shared intelligence substrate. It is neither another manifestation mode nor a parallel agent runtime.

Rails is outside the active architecture. TypeScript Core and native surfaces own retrieval, reasoning and manifestation.

---

## Product principles

### 1. Capability is not implementation

Flyd asks for `reddit.search`, `github.search`, `web.read`, or `youtube.search`.

It does not care whether that capability is currently provided by a CLI, API, MCP, browser session, or future implementation.

Each capability owns an ordered list of backends. The first fully ready backend supporting the requested operation becomes active. A degraded backend is used only when no ready backend exists.

Switching providers must be registry or configuration work, never resolver surgery.

### 2. Provider output is evidence, never UI

A provider may return facts, posts, files, comments, transcripts or metadata. It never tells Flyd to render a card, open a surface, click a button, or speak a sentence.

The manifestation decision remains in Flyd Core.

### 3. Sources have semantics

| Capability | Strongest signals |
|---|---|
| GitHub | code state, shipped work, releases, issues, developer discussion |
| Reddit | community experience, opinion, troubleshooting, consensus/disagreement |
| X | fast-moving reaction, first-party statements, expert discussion |
| YouTube | long-form explanation, interviews, demonstrations, transcripts |
| Web | primary sources, reference material, reporting, official pages |
| RSS | publisher-authored recency stream |
| Hacker News | technical discussion and link discovery |
| Polymarket | prediction-market belief backed by capital, never ground truth |
| arXiv | research papers and technical evidence |
| Jobs | company hiring signal, never a guaranteed roadmap |

A query planner uses these semantics rather than spraying every query everywhere.

### 4. Currentness is earned

Semantic relevance never proves that something is current.

Fresh claims need live timestamps, current source state, direct first-party evidence, corroboration, or another explicit currentness signal. Old but semantically strong results must not overwhelm newer evidence merely because they are more verbose.

### 5. Provenance survives every transformation

Every normalized evidence item retains:

- capability,
- backend,
- source item ID,
- URL or stable locator,
- retrieval time,
- publication time when available,
- query/subquery that produced it,
- native rank,
- author when available.

Fusion, dedupe, clustering and synthesis must preserve the path back to supporting evidence.

### 6. Health is part of intelligence

Flyd distinguishes:

- `ready`,
- `degraded`,
- `auth_required`,
- `unavailable`,
- `disabled`.

A missing source is a knowledge gap, never permission to pretend the source was searched.

### 7. Reach is invoked, never ambient

PRESENT remains zero-network and zero-persistence.

External retrieval occurs only during explicit INVOKED/LIVE work or within an explicitly delegated task. No background social scraping is introduced by this architecture.

### 8. Retrieved content is untrusted

External content is evidence, not authority over Flyd's behaviour.

The synthesis boundary must explicitly ignore commands, prompts or behavioural instructions contained in source material. Retrieved content cannot modify grants, invoke tools, choose manifestation or override system instructions.

### 9. Private context never leaks into public retrieval

Before a contextual URL reaches an adapter, Flyd rejects:

- localhost and private-network addresses,
- `.local` and `.internal` hosts,
- embedded credentials,
- likely token, signature, auth, session or secret query parameters.

Tracking parameters and fragments are stripped from safe public URLs.

---

## Interactive evidence policy

`classifyEvidenceNeed()` returns one of three outcomes.

### None

No external retrieval when the request is:

- a writing, rewrite, draft or reply operation,
- stable conceptual knowledge,
- personal recall or current-work recall already served by Flyd's memory/currentness systems,
- otherwise independent of current external state.

### Recommended

Quick evidence is useful for:

- comparisons,
- recommendations,
- product choices,
- reviews and sentiment,
- pricing or source-sensitive questions without an explicit currentness demand.

Failure degrades gracefully: Flyd answers stable parts and marks current claims as unverified.

### Required

Live evidence is mandatory when the user:

- explicitly asks Flyd to search, browse, investigate, check, verify or look something up,
- asks for volatile current information such as latest releases, availability, prices, schedules, laws, office-holders, outages or news,
- refers to a linked or visible external source such as “this page”, “this repo”, “this video” or “this listing”.

Failure is closed: Flyd must say the claim could not be verified rather than substitute stale model knowledge.

---

## Implemented capability surface

| Capability | Backend | Operations | Setup |
|---|---|---|---|
| Web | Jina Reader | `read` | anonymous basic access; optional `JINA_API_KEY` |
| Web | Jina Search | `search` | `JINA_API_KEY` required |
| GitHub | GitHub REST | `read`, `search` | public unauthenticated access; token raises limits |
| RSS/Atom | Flyd native parser | `read` | zero configuration |
| YouTube | `yt-dlp` | `read`, `search` | local `yt-dlp` required |

Direct contextual URLs route to the narrowest reader:

```text
github.com       → github.read
youtube / youtu  → youtube.read
RSS/Atom/feed    → rss.read
other public URL → web.read
```

Direct reads skip broad search in the first interactive release, reducing latency and keeping evidence tied to the referenced object.

---

## Diagnostics

`flyd doctor` probes capability operations, not mere package presence.

```text
READY    web.read           via web:jina-reader
AUTH     web.search
DEGRADED github.search      via github:rest
READY    rss.read           via rss:native
DOWN     youtube.search
```

`flyd doctor --json` exposes the same information as structured data.

---

## Resolution integration

Both INVOKED and LIVE converge on Flyd's shared resolution-model query boundary.

```text
route + memory + environment
          ↓
classifyEvidenceNeed()
          ↓ when material
quick Evidence Engine research
          ↓
bounded evidence block
          ↓
resolution synthesis
```

The evidence block:

- is capped in size,
- preserves source URLs and timestamps,
- labels source text as untrusted,
- exposes gaps explicitly,
- distinguishes evidence from inference,
- prevents current claims from falling back silently to model memory.

Interactive retrieval has a default six-second budget, configurable through `FLYD_EVIDENCE_TIMEOUT_MS`. Successful bundles are cached for sixty seconds. `FLYD_EVIDENCE_ENABLED=false` disables the integration without changing code.

LIVE's realtime instructions require current, linked, comparative, personal and explicitly researched questions to pass through `flyd_resolve_intent`, ensuring they inherit the same evidence policy.

---

## Manifestation rules

Evidence does not dictate manifestation.

```text
single concise grounded answer → AUGMENT
small choice set               → AUGMENT
multi-source comparison        → COMPOSE
extended investigation         → DELEGATED → COMPOSE/AUGMENT
text intended for focused app  → NATIVE after synthesis
```

The Evidence Engine never returns presentation instructions.

---

## Privacy and credentials

### Credential isolation

Provider credentials and cookies are scoped to their adapter. Flyd never exposes a credential-filled environment to arbitrary model or tool execution.

### Browser-backed sources

Flyd may use an existing authenticated browser session only when the capability explicitly declares that mechanism and the user has enabled it. The Evidence Engine does not automate login or bypass verification controls.

### Persistence

Raw external results are invocation-scoped by default. Only derived meaning may enter long-term memory through existing significance and learning rules.

Retrieval alone never turns a result into a remembered fact.

---

## Relationship to Agent Reach

Flyd borrows Agent Reach's architecture without making it the permanent runtime contract.

Agent Reach remains useful as:

- a reference for backend ordering,
- a health/probe source,
- an optional installer/bootstrap path,
- a discovery mechanism for maintained platform-specific tools.

Flyd's stable contract is its own capability registry.

---

## Relationship to last30days

Flyd adopts the research-engine ideas rather than the user-facing `/last30days` skill contract:

- source semantics,
- intent planning,
- weighted subqueries,
- parallel streams,
- provenance,
- weighted RRF,
- signal separation,
- source/author diversity,
- clustering and follow-up drilling,
- health-aware availability.

Flyd does not adopt its rigid response format, universal 30-day window or model-specific skill instructions.

---

## Delivery sequence

### E0 — Evidence foundation — implemented

- evidence contracts,
- capability registry and fallback,
- deterministic query planning,
- weighted RRF,
- dedupe and provenance,
- diversity controls,
- unit coverage.

### E1 — First external adapters — implemented

- Web/Jina,
- GitHub REST,
- RSS/Atom,
- YouTube/yt-dlp,
- operation-level `flyd doctor`.

### E2 — Interactive research — implemented

- deterministic evidence-need classification,
- direct contextual reads,
- bounded quick search,
- INVOKED synthesis injection,
- LIVE Core-routing policy,
- latency budget and cache,
- prompt-injection and private-URL boundaries,
- explicit failure/gap behaviour.

### E3 — Social/community reach

Add X, Reddit, Hacker News and other community adapters with explicit auth state, credential isolation and source-specific rate limits.

### E4 — Deep research + COMPOSE

Add:

- clustering,
- weighted multi-subquery planning,
- follow-up drilling,
- contradiction extraction,
- comparison-surface contract,
- evidence provenance in composed surfaces.

### E5 — Delegated Research Specialist

A Research Specialist receives:

```text
intent
world state
relevant memory
current environment refs
evidence requirements
capability grant
budget
finish condition
```

It returns an Evidence Bundle plus synthesis and claims, never UI. Flyd Core validates the evidence and chooses AUGMENT or COMPOSE.

---

## Success metrics

### Product

- correct evidence invocation rate,
- correct evidence avoidance rate,
- grounded answer rate,
- explicit insufficient-evidence rate,
- user correction rate for current facts,
- compose escalation rate for genuinely multi-source tasks.

### Retrieval

- capability availability,
- backend fallback rate,
- median/p95 probe latency,
- median/p95 quick-research latency,
- unique-source diversity,
- duplicate reduction,
- provenance completeness,
- currentness error rate.

### Cost

- external fetches per invocation,
- evidence tokens injected,
- cache-hit rate,
- questions resolved without frontier-model research planning.

---

## Non-goals

This architecture does not:

- turn PRESENT into continuous web monitoring,
- operate logged-in websites,
- replace Flyd memory with search,
- make engagement a truth score,
- expose provider output directly to UI,
- force every question through retrieval,
- impose a universal recency window,
- introduce a second intelligence runtime,
- make Rails part of the active product.

---

## Architectural decision

**Evidence is a first-class Flyd concept.**

Local observation, personal memory and external reach all produce evidence with explicit provenance and currentness. Flyd Core adjudicates that evidence before reasoning, then independently decides how the result should manifest.
