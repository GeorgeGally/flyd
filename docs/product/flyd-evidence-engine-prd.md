# Flyd Evidence Engine PRD

## Status

**Proposed foundation.** This document defines the external-evidence and capability architecture for the active Flyd overlay product.

It merges the strongest architectural ideas from:

- **Agent Reach:** provider-independent capabilities, ordered backend fallbacks, live health probing, explicit setup/credential state.
- **last30days:** intent-aware research planning, source semantics, parallel retrieval, provenance, freshness/engagement-aware ranking, reciprocal-rank fusion, diversity controls, clustering and evidence-first synthesis.

Flyd does **not** adopt either project as the intelligence layer. Flyd Core remains the authority. External tools supply evidence; Flyd decides what the evidence means and how to manifest the result.

---

## Product thesis

Flyd already has three strong primitives:

1. **Local world** — the Mac environment visible at invocation time.
2. **Personal world** — memory, projects, preferences, beliefs and recent work.
3. **Manifestation** — native actions, augmentations, composed surfaces and later delegation.

The missing primitive is a trustworthy model of the **external world**.

Today a general question can be answered from model knowledge, screen context and Flyd memory, but Flyd has no first-class mechanism for deciding:

- whether live external evidence is required,
- which source types are epistemically appropriate,
- which concrete backend is currently healthy,
- how results from different sources should be fused,
- which evidence is actually current,
- what provenance supports a claim,
- when evidence is insufficient or contradictory.

The result is a brittle boundary: the model can reason, but it does not yet have a principled way to reach into the world and adjudicate what it finds.

**Flyd should treat external information the same way it now treats memory currentness: as evidence that must be selected, ranked, corroborated and bounded before it influences an answer.**

---

## The core architecture

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

The Evidence Engine is not another manifestation mode and not another agent. It is a shared intelligence substrate.

---

## Product principles

### 1. Capability is not implementation

Flyd asks for `reddit.search`, `github.search`, `web.read`, or `youtube.search`.

It does not care whether that capability is currently provided by a CLI, an API, MCP, browser session, or a future implementation.

Each capability owns an ordered list of backends. The first backend that passes a real health probe and supports the requested operation becomes active.

Switching providers must be configuration or registry work, not resolver surgery.

### 2. Provider output is evidence, never UI

This extends an existing Flyd invariant.

A provider may return facts, posts, files, comments, market odds, transcripts or metadata. It never tells Flyd to render a card, open a surface, click a button, or speak a sentence.

The manifestation decision remains in Flyd Core.

### 3. Sources have semantics

A source is more than a URL.

Flyd must understand what a source is good evidence for.

Examples:

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

A query planner uses these semantics to select sources rather than spraying every query everywhere.

### 4. Currentness is earned

Semantic relevance never proves that something is current.

This is the external-world version of the memory-currentness rule already learned in Flyd.

Fresh claims need live timestamps, current source state, direct first-party evidence, corroboration, or another explicit currentness signal.

Old but semantically strong results must not overwhelm newer evidence merely because they are more verbose.

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

Fusion, dedupe, clustering and synthesis must never destroy the path back to supporting evidence.

### 6. Health is part of intelligence

Flyd should know the difference between:

- `ready`,
- `degraded`,
- `auth_required`,
- `unavailable`,
- `disabled`.

A missing source is a knowledge gap, not permission to silently pretend the source was searched.

### 7. Reach is invoked, not ambient

PRESENT remains zero-network and zero-persistence.

External evidence retrieval occurs only during explicit INVOKED/LIVE work or within an explicitly delegated task.

No background social scraping is introduced by this PRD.

---

## User experience

### Example: contextual question

The user is looking at a villa listing and asks:

> Is this actually a decent price?

Flyd should be able to combine:

- the listing currently on screen,
- remembered budget and prior negotiations,
- current comparable listings,
- recent area discussion,
- current infrastructure/development information,
- source confidence and date windows.

If the answer can be expressed concisely, Flyd returns an augmentation.

If the task becomes a multi-source comparison, Flyd escalates to COMPOSE.

### Example: LIVE

The user says:

> What is everyone saying about this?

Flyd resolves "this" from the current environment, determines that community sentiment is requested, prioritises discussion/social sources, retrieves current evidence, and answers naturally in LIVE.

### Example: product/technical research

The user asks:

> Compare these three agent frameworks based on what developers are actually running into this month.

Flyd should prefer GitHub issues/discussions, Hacker News, Reddit, X and relevant long-form technical content rather than generic SEO comparison pages.

### Example: insufficient reach

The user asks for current X reaction but X is not authenticated.

Flyd may still answer from healthy sources if sufficient, but the Evidence Bundle records `x: auth_required` as a gap. It must not imply that X was searched.

---

## Evidence contract

Every retrieved item normalizes into a source-independent `EvidenceItem`.

Required fields:

```text
id
capability
backend
kind
content
locator
retrievedAt
publishedAt?
author?
queryLabel
nativeRank
localRelevance
freshness
sourceQuality
engagement?
metadata
provenance[]
```

`kind` describes evidence semantics, for example:

```text
reference
first_party_statement
discussion
social
code
release
video
market
news
job_signal
research
```

The contract deliberately separates:

- **epistemic confidence** — how trustworthy this evidence is for the claim type,
- **freshness** — how current it is,
- **relevance** — how well it answers this query,
- **engagement** — how much attention it received,
- **source quality** — prior reliability/authority of the source class.

No single score should silently collapse these dimensions before the final ranking step.

---

## Capability registry

### Capability adapter

A backend adapter declares:

```text
id
capability
priority
operations[]
signals[]
probe()
search?()
read?()
```

The registry supports multiple adapters for one capability.

Example:

```text
x.search
  1. twitter-cli
  2. OpenCLI
  3. future provider

reddit.search
  1. OpenCLI
  2. rdt-cli
  3. future provider
```

### Probe rules

A probe must test actual usability, not merely binary presence.

Examples:

- command exists **and** a harmless status/read call succeeds,
- API key exists **and** endpoint responds,
- browser-backed capability has an existing user-controlled authenticated session,
- auth-required capability reports `auth_required` rather than `unavailable`.

### Health output

```text
CapabilityHealth {
  capability
  status
  activeBackend?
  checkedAt
  reason?
  fix?
}
```

The health model is usable by diagnostics, settings and the planner.

---

## Research planning

### Intent classes

The initial planner supports:

```text
factual
opinion
how_to
comparison
breaking_news
prediction
product
```

The class is separate from Flyd's manifestation route.

A request may be `ask_answer` for UI purposes while simultaneously being a `comparison` for evidence planning.

### Source priorities

Initial defaults:

| Research intent | Preferred capabilities |
|---|---|
| factual | web, github, hackernews, reddit |
| opinion | reddit, x, youtube, hackernews |
| how_to | youtube, reddit, github, web |
| comparison | reddit, github, hackernews, x, youtube, web |
| breaking_news | x, web, reddit, hackernews, youtube |
| prediction | polymarket, x, web, hackernews, reddit |
| product | reddit, youtube, x, web, github |

Unavailable capabilities are removed before execution, not after failure.

### Depth budgets

```text
quick   — 2-3 best source classes, low latency, suitable for INVOKED/LIVE
default — broader parallel retrieval
 deep   — delegated/composed research, larger candidate pool and follow-up retrieval
```

The planner owns explicit result/fetch budgets so research cost and latency remain bounded.

### Subqueries

The architecture supports weighted subqueries from day one, even if the foundation initially uses deterministic single-query planning.

Examples:

```text
"Acme pricing"
"Acme complaints"
"Acme release notes"
```

Each stream retains its query label and weight for later fusion.

---

## Fusion and ranking

The initial fusion algorithm uses weighted Reciprocal Rank Fusion (RRF) over `(subquery × capability)` streams.

Why RRF:

- provider scores are not comparable across platforms,
- native rank is usually more meaningful than a fake cross-provider numeric score,
- repeated appearance across independent streams naturally increases confidence,
- it remains deterministic and testable.

The fused candidate score starts with:

```text
subqueryWeight × sourceWeight / (K + nativeRank)
```

Ranking tie-breakers may use:

1. local relevance,
2. freshness,
3. source quality,
4. engagement where appropriate.

### Diversity controls

The pool must resist popularity monocultures.

Foundation controls:

- dedupe canonical URLs/stable IDs,
- maximum items per author,
- minimum representation for sufficiently relevant source classes,
- low-relevance sources receive no reserved quota.

A viral but irrelevant result must never win purely through engagement.

### Engagement

Engagement is a signal, not truth.

High upvotes/views/likes can increase salience **after relevance passes a floor**. Engagement must never compensate for irrelevance or weak provenance.

---

## Evidence Bundle

Research returns a structured bundle before any answer is written:

```text
EvidenceBundle {
  query
  intent
  generatedAt
  plan
  evidence[]
  conflicts[]
  gaps[]
  capabilityHealth[]
  provenanceSummary
}
```

The bundle becomes the single boundary between retrieval and reasoning.

Flyd's model receives curated evidence, not raw provider dumps.

---

## Currentness and corroboration

The existing Flyd memory repair established an important rule: **live corroboration beats semantic strength**.

The Evidence Engine generalises it.

A claim can be tagged current when supported by one or more of:

- direct first-party source with a recent timestamp,
- live repository/release state,
- multiple independent recent sources,
- a source whose semantics represent current state,
- explicit date-window match.

Currentness is claim-specific.

A two-year-old official document can still be authoritative for a stable fact while being poor evidence for "what is happening now".

Contradictory current sources remain contradictory. Flyd should preserve the conflict rather than selecting whichever has the highest lexical similarity.

---

## Resolver integration

The Evidence Engine runs only when the intent needs external evidence.

### Fast path

```text
INVOKED
  ↓
deterministic/native request?
  → existing fast path
  ↓
answer/draft route
  ↓
evidence need classifier
  ├─ none → existing memory + model path
  └─ external → Evidence Engine
```

### Latency

External retrieval must not poison simple overlay interactions.

Targets:

- no evidence-engine work for deterministic text operations,
- no external retrieval for ordinary rewrites/drafts unless explicitly required,
- `quick` evidence retrieval designed for a bounded interactive budget,
- deeper work escalates to COMPOSE/DELEGATED instead of holding an invocation indefinitely.

### LIVE

LIVE uses the same evidence boundary.

The realtime model should call a Flyd research tool, not individual social/web providers. Flyd Core decides the plan and returns an Evidence Bundle or a compact grounded synthesis.

---

## Manifestation rules

Evidence does not dictate manifestation.

Typical mappings:

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

Provider credentials/cookies must be scoped to their adapter.

Do not expose a giant credential-filled environment to arbitrary model/tool execution.

Each adapter receives only the secrets it needs.

### Browser-backed sources

Flyd may use an existing authenticated browser session only when the capability explicitly declares that mechanism and the user has enabled it.

The Evidence Engine must not automate login or bypass verification/risk controls.

### Persistence

Raw external results are invocation-scoped by default.

Only derived meaning may enter long-term Flyd memory through the existing memory significance/learning rules.

A research result being retrieved does not automatically make it a remembered fact.

---

## Relationship to Agent Reach

Flyd should borrow Agent Reach's architecture, but should not make Agent Reach the permanent runtime contract.

Agent Reach is useful as:

- an optional installer/bootstrap path,
- a reference implementation for backend ordering,
- a health/probe source,
- a way to discover reliable platform-specific tools.

Flyd's stable contract is its own capability registry.

This avoids coupling intelligence to one external project's command surface while preserving the benefit of its rapidly maintained backend knowledge.

---

## Relationship to last30days

Flyd should borrow last30days' research-engine ideas rather than its user-facing skill contract.

Adopt:

- source semantics,
- research intent planning,
- weighted subqueries,
- parallel streams,
- provenance,
- weighted RRF,
- relevance/freshness/source-quality separation,
- author/source diversity,
- clustering and follow-up drilling,
- health-aware source availability.

Do not adopt:

- `/last30days` as Flyd's UX,
- its rigid output-format laws,
- a 30-day window as a universal assumption,
- model-specific skill instructions as architecture.

Flyd chooses the date window and manifestation from user intent.

---

## Delivery sequence

### E0 — Evidence foundation (this PR)

Ship pure TypeScript primitives in Flyd Core:

- `EvidenceItem`, `EvidenceBundle`, `QueryPlan` contracts,
- capability adapter/registry contract,
- ordered backend selection via real health probes,
- deterministic research-intent planner,
- weighted RRF fusion,
- URL/stable-ID dedupe,
- per-author and per-source diversity controls,
- unit tests.

No network adapters and no resolver behaviour change yet.

Exit criteria:

1. multiple backends can register for one capability,
2. unhealthy primary falls through to healthy secondary,
3. planner changes source priority by research intent,
4. unavailable capabilities are excluded with explicit gaps,
5. duplicate evidence from multiple streams merges while preserving provenance,
6. fused ranking remains deterministic,
7. one author cannot dominate the final pool,
8. existing overlay behaviour is unchanged.

### E1 — First external adapters

Implement the lowest-risk/highest-value capabilities first:

- `web.read/search`,
- `github.read/search`,
- `rss.read`,
- `youtube.read/search` where available.

Add `flyd doctor`/Core health output for evidence capabilities.

### E2 — Interactive research

Add `classifyEvidenceNeed()` to the resolution pipeline.

For `ask_answer` intents requiring live information:

- run `quick` planning,
- retrieve healthy sources in parallel,
- inject the curated Evidence Bundle into synthesis,
- surface missing capabilities as internal gaps.

### E3 — Social/community reach

Add X, Reddit, Hacker News and other community adapters with explicit auth state and credential isolation.

### E4 — Deep research + COMPOSE

Add:

- clustering,
- weighted multi-subquery planning,
- follow-up drilling,
- comparison surface contract,
- evidence provenance in composed surfaces.

### E5 — DELEGATED research specialist

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

It returns an Evidence Bundle + synthesis/claims, never UI.

Flyd Core validates the evidence and chooses AUGMENT/COMPOSE.

---

## Success metrics

### Product

- percentage of current-information questions that invoke evidence when they should,
- percentage that avoid evidence when model/local/personal context is sufficient,
- grounded answer rate,
- explicit insufficient-evidence rate rather than fabricated confidence,
- user correction rate for current factual answers,
- compose escalation rate for genuinely multi-source tasks.

### Retrieval

- capability availability by source,
- backend fallback rate,
- median/p95 probe latency,
- median/p95 quick research latency,
- unique-source diversity,
- duplicate rate before/after normalization,
- citation/provenance completeness,
- currentness error rate.

### Cost

- average external fetches per quick invocation,
- average tokens injected from Evidence Bundle,
- percentage of questions resolved without frontier-model research planning.

---

## Non-goals

This architecture does not:

- turn PRESENT into continuous web monitoring,
- auto-follow feeds or topics,
- operate logged-in websites,
- replace Flyd memory with search,
- make engagement a truth score,
- expose provider-specific output directly to the UI,
- force all questions through external retrieval,
- make a universal 30-day recency window,
- introduce a second intelligence runtime beside Flyd Core.

---

## Architectural decision

**Evidence becomes a first-class Flyd concept.**

Local observation, personal memory and external reach all produce evidence with explicit provenance/currentness. Flyd Core adjudicates that evidence before reasoning, then independently decides how the result should manifest.

That gives Flyd a coherent path from "I remember" and "I can see" to "I checked what is true now" without turning the product into a collection of search tools.