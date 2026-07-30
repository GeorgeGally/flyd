# Flyd Evidence Engine — E3 + E4 implementation

## Status

Implemented on `agent/evidence-engine-foundation`.

This work remains entirely in TypeScript Core plus the existing thin Mac adapter. Rails is not a runtime, renderer, retrieval provider, or fallback.

## E3 — social and community reach

### Hacker News

- Anonymous Algolia search, ordered through the normal capability registry.
- Firebase item reads for visible `news.ycombinator.com/item` links.
- Story and comment evidence retain author, time, engagement, linked source and item provenance.
- Source-local minimum request interval.

### Reddit

- Public Reddit JSON search and thread reads work without credentials.
- Public mode is honestly reported as `degraded` because availability and rate limits are less reliable.
- Optional `REDDIT_ACCESS_TOKEN` enables authenticated OAuth API access.
- Posts and top-level comments are normalized separately and retain subreddit, author, score and permalink provenance.
- Credentials and rate state are isolated inside the Reddit adapter.

### X

- X API v2 recent search and direct status reads.
- Requires `X_BEARER_TOKEN` or `TWITTER_BEARER_TOKEN`.
- Missing or rejected credentials remain distinct from rate limiting and unavailable plan access.
- Author expansions, verification status, metrics, timestamps and post locators are preserved.
- No browser-session automation and no shared credential jar.

`flyd doctor` now reports all three capability families through the same operation-level health model used by E1.

## E4 — deep investigation

### Multi-lens planning

Quick research remains one bounded primary query. Default and deep research add weighted source lenses:

1. primary
2. official / first-party
3. community experience
4. limitations and criticism
5. alternatives and trade-offs (deep)
6. recent updates (deep)

Each lens uses source classes appropriate to its semantics rather than sending every query to every provider.

### One bounded drill-down round

After first-pass fusion, Flyd clusters the evidence. High-ranking clusters supported by fewer than two source classes generate at most two independent-evidence or limitation queries. There is no unbounded recursive browsing loop.

### Clustering

Evidence is grouped by semantic term overlap. Each cluster records:

- representative evidence,
- all evidence IDs,
- source capabilities,
- authors,
- support score,
- source diversity.

Clusters organise evidence; they do not replace the model's judgement.

### Contradictions

Flyd checks independent evidence with strong topical overlap for opposing assertions. Conflicts retain both evidence IDs, the shared topic, a reason and confidence. They are shown to the model and in the dossier instead of being averaged into one answer.

### Core-owned COMPOSE surface

Explicit requests such as “deep research,” “deep dive,” “comprehensive comparison,” or “investigate thoroughly” use deep research and request COMPOSE.

The Evidence Engine publishes a short-lived evidence dossier to a loopback-only TypeScript Core surface server. The same Flyd resolution model returns a structured `surfaceSynthesis` containing:

- editorial title,
- executive summary,
- evidence-linked findings,
- confidence per finding,
- recommendation when supported,
- uncertainties.

After the model responds, Core finalizes the surface and the existing Mac adapter opens it through the normal `composeUrl` path.

The surface:

- uses a strict Content Security Policy,
- loads no remote scripts,
- retains clickable source provenance,
- shows conflicts and coverage gaps,
- expires after thirty minutes,
- falls back to a detailed augment response if the local renderer cannot start.

## Runtime budgets

- Interactive quick research: six seconds by default.
- Deep research: thirty seconds by default.
- Deep search is bounded to one primary pass plus one drill-down pass.
- Evidence caches remain short-lived and do not write raw external content into long-term memory.

Environment controls:

```text
FLYD_EVIDENCE_ENABLED=false
FLYD_EVIDENCE_TIMEOUT_MS=6000
FLYD_DEEP_RESEARCH_TIMEOUT_MS=30000
JINA_API_KEY=...
GITHUB_TOKEN=...
REDDIT_ACCESS_TOKEN=...
X_BEARER_TOKEN=...
```

## Explicit non-goals

E3 and E4 do not:

- automate logged-in social websites,
- post, vote, follow, message, or mutate social accounts,
- claim X or authenticated Reddit access without valid credentials,
- run background monitoring,
- recursively browse without a hard bound,
- treat popularity as truth,
- let retrieved instructions alter Flyd behaviour,
- store external evidence as personal memory automatically,
- reintroduce Rails.
