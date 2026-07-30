# Flyd Evidence Engine PRD

## Status

**E0 + E1 implemented.** This document defines the external-evidence and capability architecture for the active Flyd product.

It merges the strongest architectural ideas from:

- **Agent Reach:** provider-independent capabilities, ordered backend fallbacks, live health probing, explicit setup/credential state.
- **last30days:** intent-aware research planning, source semantics, parallel retrieval, provenance, freshness/engagement-aware ranking, reciprocal-rank fusion, diversity controls, clustering and evidence-first synthesis.

Flyd does **not** adopt either project as the intelligence layer. Flyd Core remains the authority. External tools supply evidence; Flyd decides what the evidence means and how to manifest the result.

**Rails is not part of the active Flyd architecture.** The Evidence Engine, capability health, retrieval, reasoning and future composition paths live in TypeScript Core plus native surfaces. Rails code remaining in the repository is legacy only and must not be extended for this architecture.

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

```text
LOCAL
- listing visible on screen
- location / price / lease terms

PERSONAL
- prior villa negotiations
- budget and preferences
- previously rejected areas / terms

EXTERNAL
- current comparable listings
- recent local market information
- relevant community discussion
- local infrastructure/development evidence
```

Flyd then adjudicates that evidence and chooses the manifestation:

- a short answer if the conclusion is simple,
- an augmentation if a few comparisons matter,
- a composed comparison surface if the task needs multi-source structure.

### Example: LIVE

User says while looking at something:

> What's everyone saying about this?

```text
screen/context
    ↓
resolve referent
    ↓
plan opinion/discussion research
    ↓
Reddit + X + web (healthy sources only)
    ↓
rank/fuse evidence
    ↓
spoken synthesis + optional augmentation
```

### Example: capability gap

User asks for current X reaction, but the X adapter requires authentication.

Flyd does not silently replace that with a generic web answer and claim broad consensus.

The internal result records:

```json
{
  "capability": "x",
  "status": "auth_required",
  "gap": "X-specific reaction was not checked"
}
```

Flyd may still answer from other evidence, but the reduced coverage affects confidence.

---

## Evidence model

The key abstraction is not a search result. It is an evidence item.

```ts
interface EvidenceItem {
  id: string

  capability: string
  backend: string
  kind: EvidenceKind

  title?: string
  content: string
  locator?: string
  sourceItemId: string

  retrievedAt: string
  publishedAt?: string
  author?: string

  queryLabel: string
  nativeRank: number

  localRelevance: number
  freshness: number
  sourceQuality: number
  engagement?: number

  metadata?: Record<string, unknown>
  provenance: EvidenceProvenance[]
}
```

### Evidence dimensions are intentionally separate

Do not collapse everything into one mysterious confidence score too early.

`localRelevance`
: How well this result answers this specific query.

`freshness`
: How current the evidence is for the question being asked.

`sourceQuality`
: How appropriate/reliable this source is for this claim type.

`engagement`
: Popularity/attention signal. Useful for community salience, not truth.

`nativeRank`
: Position returned by the source itself.

`provenance`
: Every retrieval path that independently surfaced this evidence.

These values may influence ranking differently by intent.

---

## Source semantics

### Capability descriptor

Each capability declares semantic strengths alongside mechanics.

```ts
interface CapabilityAdapter {
  id: string
  capability: CapabilityName
  priority: number

  operations: ("read" | "search")[]
  signals: EvidenceSignal[]

  probe(): Promise<CapabilityProbe>
  read?(): Promise<EvidenceItem[]>
  search?(): Promise<EvidenceItem[]>
}
```

Example:

```ts
GitHubAdapter {
  capability: "github"
  signals: ["code", "release", "discussion", "first_party"]
}

RedditAdapter {
  capability: "reddit"
  signals: ["discussion", "social"]
}
```

This lets the planner ask for evidence classes instead of hard-coding one provider.

---

## Capability health

Health checks must test actual usability.

Checking only whether a binary exists is insufficient.

A backend probe should validate the minimum safe operation needed to know whether it can serve requests.

```ts
interface CapabilityProbe {
  status:
    | "ready"
    | "degraded"
    | "auth_required"
    | "unavailable"
    | "disabled"

  reason?: string
  fix?: string
}
```

### Backend selection

```text
x.search
  ├─ backend A  ready       ← use
  ├─ backend B  ready
  └─ backend C  unavailable
```

or:

```text
x.search
  ├─ backend A  unavailable
  ├─ backend B  degraded    ← fallback if no ready backend exists
  └─ backend C  auth_required
```

Rules:

1. choose the first **ready** backend by configured priority,
2. if no backend is ready, choose the first **degraded but usable** backend,
3. distinguish `auth_required` from breakage,
4. expose the chosen backend only as provenance/diagnostics,
5. reasoning asks for the capability, never a concrete tool.

### Doctor

Flyd should expose this internally and through developer diagnostics:

```text
Web.read        READY       web:jina-reader
Web.search      AUTH        JINA_API_KEY missing
GitHub.read     DEGRADED    public REST, low unauthenticated limit
GitHub.search   DEGRADED    public REST, low unauthenticated limit
RSS.read        READY       rss:native
YouTube.read    READY       youtube:yt-dlp
YouTube.search  READY       youtube:yt-dlp
X.search        AUTH        credentials missing
```

The first E1 implementation exposes this through `flyd doctor` and `flyd doctor --json`.

---

## Query planning

### Research intent

The Evidence Engine classifies research intent separately from the overlay's manifestation routing.

Initial intent classes:

```text
factual
opinion
how_to
comparison
breaking_news
prediction
product
```

This classifier determines what evidence is useful, not what UI to show.

### Source priorities

Illustrative defaults:

```text
factual
  web > github > arxiv > rss

opinion
  reddit > x > youtube > web

how_to
  youtube > reddit > github > web

comparison
  web > reddit > youtube > github

breaking_news
  x > web > rss > reddit

prediction
  polymarket > x > web > reddit

product
  reddit > youtube > web
```

Unavailable sources disappear from the executable plan but remain visible as evidence gaps when material.

### Deterministic before frontier intelligence

Common source selection should be deterministic/cheap.

Do not spend a frontier-model call deciding that an opinion query benefits from discussion sources unless ambiguity genuinely requires it.

A later planner may use a small model to decompose difficult questions, but deterministic policy remains the fallback.

---

## Query decomposition

Deep research can produce multiple weighted subqueries.

Example:

> Is this new AI coding tool actually good?

```text
primary          1.00   "tool name"
quality          0.90   "tool name review reliability problems"
developer        0.85   "tool name github issues releases"
comparison       0.75   "tool name alternatives comparison"
current          0.90   "tool name recent update"
```

Each subquery selects only semantically useful capabilities.

The result is a set of `(subquery × capability)` streams.

---

## Retrieval

Streams run in parallel within explicit budgets.

```text
               primary
          ┌──────┼──────┐
          ↓      ↓      ↓
        web   reddit   github

               quality
          ┌──────┼──────┐
          ↓      ↓      ↓
        web   reddit  youtube
```

Each adapter returns normalized `EvidenceItem`s immediately. Provider-specific response shapes do not propagate past the adapter boundary.

### Budgets

The planner controls:

- depth (`quick`, `default`, `deep`),
- maximum total results,
- maximum results per stream,
- eventual latency/fetch budgets.

Initial defaults:

```text
quick    10 final items / 3 per stream
standard 20 final items / 5 per stream
deep     30 final items / 8 per stream
```

`quick` must be suitable for INVOKED/LIVE latency.

---

## Ranking and evidence fusion

### Reciprocal rank fusion

Use weighted reciprocal rank fusion across independent streams.

Conceptually:

```text
score(item) +=
  streamWeight
  × sourceWeight
  × 1 / (K + nativeRank)
```

RRF is intentionally robust when source score scales are incomparable.

A Reddit score of `812`, a GitHub search score of `4.1`, and an internal web relevance of `0.78` should not be naively compared.

### Preserve independent signals

RRF determines candidate order but does not erase:

- relevance,
- freshness,
- source quality,
- engagement,
- provenance.

Flyd can use those signals during currentness/corroboration and synthesis.

### Dedupe

Canonical dedupe prefers:

1. normalized canonical locator,
2. stable source ID when no URL exists.

Normalization strips tracking parameters and common host aliases.

When duplicates merge:

- retain the strongest representation,
- accumulate RRF contribution,
- merge provenance,
- retain all capabilities that independently surfaced it.

### Diversity

One prolific author or one source class should not fill the evidence window.

Initial controls:

- maximum 3 final items per author,
- reserve at least one sufficiently relevant result from each useful capability,
- then fill remaining slots by fused rank.

This guards against accidental single-community consensus.

---

## Currentness and corroboration

This must remain distinct from relevance.

### Currentness rules

Currentness may be supported by:

- recent publication/update timestamp,
- current live API state,
- current release/commit state,
- direct first-party statement,
- corroboration across independent contemporary sources.

It must never be inferred solely from semantic similarity.

### External evidence and personal currentness

The same conceptual rule should govern Flyd's internal and external worlds:

```text
memory says X        → historical/personal evidence
screen says X        → immediate local evidence
GitHub says X        → current code evidence
web says X           → current external evidence
user confirms X      → authoritative personal evidence
```

Flyd adjudicates these based on the question.

There is no universal source order.

For:

> what am I working on?

live repo/screen evidence dominates web.

For:

> what version did OpenAI release today?

current first-party external evidence dominates old memory.

---

## Conflicts

Evidence disagreement is a first-class result.

```ts
interface EvidenceConflict {
  left: string
  right: string
  reason: string
}
```

Examples:

- official docs say feature is available, community reports rollout missing,
- two listings provide conflicting lease terms,
- old article contradicts current repository state.

Flyd should synthesize the disagreement rather than averaging it into fake certainty.

---

## Evidence Bundle

The Evidence Engine returns one bounded contract to Flyd reasoning.

```ts
interface EvidenceBundle {
  query: string
  intent: ResearchIntent
  generatedAt: string
  plan: QueryPlan
  evidence: RankedEvidence[]
  conflicts: EvidenceConflict[]
  gaps: EvidenceGap[]
  capabilityHealth: CapabilityHealth[]
}
```

The Bundle is the boundary.

Resolver prompts, LIVE, COMPOSE and future delegated specialists should consume Evidence Bundles rather than provider responses.

---

## Interaction with Flyd memory

External research must not automatically become memory.

```text
external evidence
       ↓
    reasoning
       ↓
 user-visible outcome
       ↓
 existing significance / learning gate
       ↓
 possible durable memory
```

Raw search results are not knowledge about the user.

A Reddit comment retrieved once must not silently become a durable personal belief.

However, durable derived information can be learned when the existing memory policy decides it is significant.

Example:

> User repeatedly rejects villas more than 20 minutes from school.

That behavioural preference may become memory.

The temporary comparable listings used to establish it should not.

---

## INVOKED integration

E2 introduces `classifyEvidenceNeed()` into resolution.

Conceptually:

```text
manifest
  │
  ├─ Present Model
  ├─ memory retrieval
  ├─ route classification
  └─ evidence-need classification
          │
          ├─ none
          ├─ quick external evidence
          └─ deep/delegated investigation
```

These should execute in parallel where possible.

### Evidence need

External retrieval is useful when the question materially depends on:

- current facts,
- external entities/state,
- live prices/availability,
- community sentiment,
- recent events,
- sources not represented by Flyd memory/local context.

It should be skipped when:

- editing text,
- dictation,
- rewriting,
- purely personal recall,
- local app manipulation,
- static reasoning the model can answer confidently without current evidence.

---

## LIVE integration

LIVE gains a Core-owned evidence tool rather than direct provider tools.

Preferred conceptual tool:

```text
flyd_research_evidence(query, depth?)
```

rather than:

```text
google_search
reddit_search
twitter_search
yt_dlp
...
```

This is important.

Realtime should ask Flyd for evidence. It should not become a second orchestration engine deciding providers independently.

Core then:

1. checks the query,
2. applies capability/credential policy,
3. builds the plan,
4. retrieves evidence,
5. returns the bounded Evidence Bundle/synthesis.

---

## DELEGATED integration

Deep research is a natural first serious DELEGATED specialist.

```text
Research Specialist

input
  goal
  context
  memory
  evidence requirements
  capability grant
  budget

output
  claims
  Evidence Bundle
  gaps
  conflicts
  confidence
```

It never returns UI instructions.

Flyd decides whether its result becomes:

- spoken response,
- augmentation,
- composed surface,
- native text,
- additional delegated action.

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

### E0 — Evidence foundation — SHIPPED

Pure TypeScript primitives in Flyd Core:

- `EvidenceItem`, `EvidenceBundle`, `QueryPlan` contracts,
- capability adapter/registry contract,
- ordered backend selection via real health probes,
- deterministic research-intent planner,
- weighted RRF fusion,
- URL/stable-ID dedupe,
- per-author and per-source diversity controls,
- unit tests.

Exit criteria achieved at the contract/foundation level.

### E1 — First external adapters — SHIPPED

Implemented:

- `web.read` via Jina Reader,
- `web.search` via Jina Search,
- `github.read/search` via GitHub REST,
- `rss.read` via a native Flyd parser,
- `youtube.read/search` via `yt-dlp`, including transcript extraction when available,
- `flyd doctor` / `flyd doctor --json` operation-level capability diagnostics,
- explicit `ready` / `degraded` / `auth_required` / `unavailable` states,
- adapter-level tests with mocked network/command boundaries.

E1 changes no `/manifest`, INVOKED, LIVE or PRESENT behavior yet.

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

COMPOSE must be implemented on the active Core/native surface architecture. Do not introduce a Rails dependency.

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
- introduce a second intelligence runtime beside Flyd Core,
- use Rails as an active Flyd runtime or composition dependency.

---

## Architectural decision

**Evidence becomes a first-class Flyd concept.**

Local observation, personal memory and external reach all produce evidence with explicit provenance/currentness. Flyd Core adjudicates that evidence before reasoning, then independently decides how the result should manifest.

That gives Flyd a coherent path from "I remember" and "I can see" to "I checked what is true now" without turning the product into a collection of search tools.
