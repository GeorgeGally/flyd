# Opinionated News Curation Design

## Purpose

Flyd must not treat an RSS entry as interesting merely because it exists or shares a keyword with stored material. Feed retrieval supplies raw evidence. Flyd applies an explicit taste profile and comparative judgment before any story is persisted as a discovery candidate.

## Taste Profile

Flyd judges stories using these preferences:

- Weird over practical.
- Novel over important.
- Deep dives over breaking news.
- Hacker mindset over consumer mindset.
- Internet archaeology, creative code, hardware oddities, protocol history, obscure media, and constrained projects over generic current events or incremental product updates.
- Generic politics, war, natural disasters, and consumer-news churn are skipped unless they directly intersect with creative, technical, or hacker culture.

The profile describes how to judge, not a closed category filter. A surprising story may qualify even without matching a known topic.

## Data Flow

1. Publisher and Reddit clients normalize raw stories.
2. Deterministic preparation removes duplicate URLs and titles, unusable records, and stale entries; it also caps and source-diversifies the batch sent for judgment.
3. `Flyd::TasteCurator` sends one compact batch to the configured LLM with the taste profile and a concise snapshot of the user's current goals, signals, reports, and recent work.
4. The curator returns strict JSON. Every retained story receives `hot`, `worth_a_look`, or `skip`, a short grounded reason, and one accepted story is designated as the rabbit hole.
5. Only `hot` and `worth_a_look` stories are enriched with page metadata and persisted through `IntelligenceState::WebDiscoveryProvider`.
6. `rabbitHole`, `interestVerdict`, and `interestReason` remain evidence metadata. They influence selection but are not rendered as explanatory UI chrome.
7. Surface composition still decides whether discovery deserves the screen. The curator does not emit layout or direct UI instructions.

## Selection Rules

- At most eight accepted stories are persisted per refresh.
- Exactly one accepted story is the rabbit hole when at least one story is accepted.
- Rabbit hole ranks first, followed by `hot`, then `worth_a_look`, while preserving the curator's comparative order.
- Unknown IDs, unknown verdicts, duplicate judgments, missing reasons, or an invalid rabbit-hole choice invalidate the curation response.
- Unjudged stories are not accepted.

## Failure Behavior

Curator failure fails the background refresh and records provider health without replacing the last usable discovery snapshot. Flyd never falls back to publishing an unfiltered batch. Individual feed failures remain isolated by the feed client.

## Feed Additions

- Core77: `https://feeds.feedburner.com/core77/blog`
- FlowingData: `https://flowingdata.com/feed`
- Design Milk: `https://feeds.feedburner.com/design-milk`

## Testing

- Catalog tests assert the three feeds exist once.
- Live endpoint verification confirms each feed produces normalized stories.
- Curator tests cover comparative verdicts, rabbit-hole priority, invalid output, duplicate candidates, stale candidates, and personal-context inclusion.
- Refresh-job tests prove only accepted stories are persisted and curation metadata is grounded.
- Evidence-selection tests prove rabbit-hole and verdict metadata affect internal discovery priority without adding visible UI text.
- Full Rails and system suites guard the existing background-only homepage and poster-stage behavior.
