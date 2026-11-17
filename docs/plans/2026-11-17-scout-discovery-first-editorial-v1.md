# Flyd Scout: Discovery-First Personal News — Implementation Plan v1

Date: 2026-11-17
Status: proposed, not implemented
Authority: docs/product/flyd-personal-intelligence-prd.md and AGENTS.md
Scope: active TypeScript Core / Scout, Evidence Engine and existing desktop/mobile news surfaces. No Rails work.
Reference: https://github.com/mvanhorn/last30days-skill (reviewed upstream v4 skill/docs, including agent JSON 1.4 and discovery JSON 1.1)
Owner: Flyd Core. Scout is a backstage producer, not a new assistant or runtime.

## 0. Decision and intended outcome

Build a **discovery-first editorial Scout** that proactively finds developments George would not have searched for, investigates the best of them, and delivers a small, confident, genuinely personal edition. Keep Flyd's existing Evidence Engine, source registry, schedule, feedback store and news surfaces. Last30days is an optional structured evidence/discovery supplier; its prose, opinions and output never take command of Flyd.

The winning experience is not "more news." It is opening Flyd and encountering 5–8 worthwhile discoveries, each with: (1) what actually happened, (2) why it is interesting to George specifically, (3) why now, (4) credible supporting links, and (5) an easy way to explore or correct the recommendation. Silence is a valid edition on a thin day. Exceptional urgent changes can still produce the existing capped proactive notification.

Deliver first as a reversible, measured improvement to Scout, not a replacement frontend, a new CoS domain, a standalone news product or another orchestration framework.

### Product outcomes

- Find significant developments *outside* a static topic list, including an exploratory/serendipity pick when grounded.
- Separate event significance, community attention, factual confidence, novelty, and personal fit. Popularity is not truth or a substitute for relevance.
- Avoid repeats of the same underlying event across outlets and days, while allowing meaningful updates.
- Produce concise, source-backed "why George should care" copy, not generic project-name flattery.
- Preserve provenance, source failures, and uncertainty through ingestion, clustering, ranking and display.
- Make preference learning causal and reversible. Not clicking a card is not evidence that George disliked it.
- Retain current time/privacy/authority contracts and bounded resource consumption.

### Non-goals

- A separate news agent, chat persona or orchestration engine.
- An always-on multi-platform scraping operation or browser-cookie harvesting.
- Turning GitHub PRs, hiring advertisements, patents or prediction markets into asserted news without independent validation.
- An algorithmic engagement feed optimised for clicks or screen time.
- Rewriting Flyd's Evidence Engine; do not copy last30days' fusion/clustering/reranking wholesale.
- Replacing current News, Today or mobile navigation with another app.
- Migrating private news artifacts into general personal memory by default.

## 1. Evidence from the current code and upstream

### Existing Flyd behaviour

1. cli/src/council/scout.ts: topic planning produces eight 2–5-word searches; the engine is called with "reddit,hackernews,youtube", two searches in parallel, and the call has a 240-second timeout. Feed retrieval covers 30 days. Independent Reddit RSS calls are intentionally separated by 61 seconds; 12 subreddit reads in an edition can make that lane slow.
2. parseLast30days retains URL, title, short summary, date and engagement as a formatted string; it discards schema_version, source_status, clusters, relevance_score, candidate_id and freshness_verdicts. Those omissions prevent robust confidence and discovery accounting.
3. runScout interleaves unseen URLs by source, caps at 200, and asks an LLM to choose a 16–24-item edition, at most three per source. The prompt mandates Bitcoin/Crypto Art first and exactly one rabbit hole. Six inspiration inserts can add visual noise.
4. unseenCandidates deduplicates exact URLs and punctuation-normalised headlines, not underlying developments. It cannot recognise independently worded coverage of one event or distinguish a genuine new development.
5. The source fitness score counts "shown" as soon as a story enters the edition and treats unliked, un-disliked exposure as weak negative evidence. That is not a confirmed view or preference. This can suppress useful sources without actual feedback.
6. The watch is a cheap, feed-only 3-hour scan with at most one notification/day. Preserve its nonintrusive behaviour. Preserve the existing daily edition, news page, on-story conversation, mobile rendering and more/less controls.
7. Flyd already has CapabilityRegistry health, EvidenceEngine, fusion, provenance, lexical clustering, contradiction checks, cost/backoff controls and canonical event policies. The existing clusterEvidence() uses lexical Jaccard overlap at a fixed threshold; it is useful as a baseline, not safe enough alone for semantic event identity.
8. AGENTS.md disallows new live Rails dependencies, logged-in social automation, treating engagement as truth, bypassing egress consent or network activity in PRESENT. This is a background scheduled INVOKED/authorised producer only.

### Upstream last30days findings

- The current agent JSON export documents schema_version 1.4 with result relevance_score, candidate_id, cluster index, engagement, date, clusters, source_status, usage and optional freshness_verdicts.
- Discovery exports a *different* schema (kind=discovery, schema_version 1.1): nominated topic, why_spiking, velocity_score, momentum, evidence_urls, independent corroboration count, status/outcome and previously_surfaced_count. It distinguishes a valid "nothing-solid" from failure.
- Upstream discovery sweeps river/hot listings before enriching nominated topics. Its interactive three-leg host-judged path uses nomination, judgment, enrichment and angle stages; a headless one-shot fallback exists and has less nuanced judgment. We should not pretend the headless heuristic is equivalent.
- Upstream's confidence floor and junk-shape filters defend against loud "help me" posts, personal musings and single-source hype.
- Upstream's v4 requires Python 3.12+. Flyd currently calls unqualified python3. The installed copy at ~/.flyd/vendor/last30days-skill and its version, interpreter, available sources and credentials must be inspected on George's Mac before cutover; GitHub repo inspection cannot prove local runtime health.
- Third-party source coverage is conditional on configuration, consent, access and cost. An absent platform is a coverage gap, not a clean zero result.

Sources:
- https://github.com/GeorgeGally/flyd/blob/main/cli/src/council/scout.ts
- https://github.com/GeorgeGally/flyd/blob/main/cli/src/evidence/
- https://github.com/GeorgeGally/flyd/blob/main/cli/src/conversation-view/page/script-today.ts
- https://github.com/mvanhorn/last30days-skill/blob/main/docs/reference/json-export.md
- https://github.com/mvanhorn/last30days-skill/blob/main/CONCEPTS.md
- https://github.com/mvanhorn/last30days-skill/blob/main/skills/last30days/references/discovery.md

## 2. Approaches evaluated

| Approach | Impact | Work | Risk | Reversible? | Decision |
| --- | --- | --- | --- | --- | --- |
| A. Prompt/ranker tune, fewer picks and source tweaks | Moderate | Low | Low | Yes | Ship useful fixes in phase 1, insufficient on its own |
| B. Consume richer last30days research and discovery in Scout | High | Moderate | Medium: runtime, latency, quality variance | Yes, flag and fall back | **Core of plan** |
| C. Build dedicated always-on news correspondents with new runtime | Potentially high | High | High: duplicated agents, cost, noisy notifications | Difficult | Reject now |
| D. Use a standing *editorial beat portfolio* in the existing Scout, fed by B, with controlled exploration | High for this user | Moderate | Medium: feedback bias/filter bubble | Yes | **Add after B succeeds** |

We are choosing B + a bounded form of D. C is the tempting overbuild. A alone improves presentation without improving discovery coverage.

## 3. Proposed architecture

Background agenda/Core tick (existing)
  -> Scout discovery scheduler, budgeted separately from the daily edition
  -> last30days adapter (versioned discovery/research JSON, no UI authority)
  -> normalized Scout observations + source health (data contracts below)
  -> existing Evidence Engine adapters/fusion where suitable
  -> event-level grouping + independent corroboration + safety/freshness gates
  -> personal relevance + editorial judgment
  -> daily edition and occasional must-know
  -> existing News / Today / mobile story projection
  -> explicit story-level feedback + outcome/evaluation log
  -> next discovery/selection cycle

Design invariants:
- Scout owns *which candidate events to investigate* and the editorial selection. The Evidence Engine owns live evidence capabilities, source/provenance semantics and retrieval policy.
- last30days supplies observations, nominations and optional ranking signals; Flyd adjudicates, verifies, stores and displays.
- One canonical event identity and a history of substantive updates; a query topic, source URL and event are not interchangeable.
- Keep news data in Scout's bounded store; no automatic promotion to personal MEMORY.md.
- Reuse existing model backoff, job isolation, lock discipline, consent/egress rules, URI guard and notifications rather than creating a new execution subsystem.
- No new model invoked merely because there is a new candidate. Cheap deterministic gates run first.

### Data contracts

**ScoutObservation** (new durable normalised raw evidence envelope):
- observationId; originalSourceId; capability; provider; sourceItemId; canonicalUrl; retrievedAt; publishedAt?; contentSnippet; title;
- communityMetrics? (numeric counters with native units, never a generic untyped engagement string); upstreamRelevance?; candidateId?; clusterRef?; originalQuery?; topicNominationId?;
- sourceHealth; evidenceRefs[]; verificationStatus; flags[]; schemaVersion; storageExpiry;
- source-level independence keys (canonical domain, author/outlet and source family), with provenance of syndication/reposts.

**ScoutNomination**:
- nominationId; label; domain/beat; origin; firstSeenAt; lastSeenAt; upstreamVelocity?; momentum?; basisEvidenceIds[]; corroboratingSourceIds[]; junkShape?; confidenceFloorPassed; reportStatus; expiration.

**ScoutStory** (editorial event, distinct from source):
- stableStoryId; headline; summary; whyNow; whyForGeorge; personalConnectionType (explicit_interest, active_work, aesthetic_affinity, exploratory); primaryUrl; evidenceRefs[]; publishedAt?; significantUpdateAt?; confidence; confidenceBasis; novelty; serendipity;
- editorialState (candidate, selected, shown, dismissed, updated); firstShownAt?; lastShownAt?; userFeedback[]; latestEditionId?; originalNominationId?;
- source gaps/contradictions are attached, not silently collapsed.

Preserve existing EditionItem shape through an additive projection. Old editions must deserialize. Keep sourceId for fitness and an independent storyId for dedupe/feedback. Provide a migration/read-compatibility test, not a destructive backfill.

## 4. Implementation phases and exit gates

### Phase 0 — Instrument baseline and verify actual runtime (no behaviour changes)

**Files:** cli/src/council/scout.ts, scout-run.ts, new cli/src/council/scout-metrics.ts, tests/fixtures, optional diagnostic CLI under cli/src/commands/.

1. Check actual Mac-installed last30days git revision/version, v4 Python >=3.12 interpreter, agent/discovery schema, installed CLI arguments and enabled/failed sources. Pin a tested commit or release for repeatable runs; do not silently upgrade the vendor clone or assume GitHub HEAD is installed.
2. Add a Scout diagnostic summary: edition age, count, sources attempted/succeeded/failed, number of fetched candidates, candidates rejected by gate, duplicate count, selection latency, engine wall time, timeout counts, estimated provider usage/cost where available, model failures, and notification count.
3. Build a **frozen baseline corpus** from real existing Scout editions and, if authorised, read-only local candidate logs. Scrub any private context before checking test fixtures into the repo. Where raw old candidates are unavailable, measure prospectively rather than invent missing data.
4. Establish editorial test fixtures covering creative coding, generative music, tool releases, generative art, internet oddities, competitor releases, duplicate stories, hype, false claims and irrelevant posts. Record a few hand-labelled "interesting / marginal / skip" examples plus reasons.
5. Add a manual blind pairwise evaluation command: show old/new outputs without revealing which algorithm produced them; never infer preference from missing clicks.

**Done when:** A developer can run one command to see what actually ran, how stale it is, why a source failed and what the current edition contains. Baseline is reproducible. No algorithmic/user-visible change.

### Phase 1 — Fix known quality problems before increasing reach

**Files:** scout.ts, scout-run.ts, scout.test.ts, existing front/mobile projections only if needed.

1. Reduce the core front-page edition target from 16–24 to **5–8 substantive stories**. Keep a secondary "Explore" or quiet overflow list only if existing UI can support it without new navigation. Do not pad; zero is valid.
2. Remove the forced Bitcoin-first taxonomy and forced rabbit hole. Order by benefit/novelty; keep topic variety as a *soft* constraint, with one exploratory slot only when its item clears the editorial bar.
3. Distinguish fetched, shortlisted, selected, rendered, actually seen (when observable and consent-compatible), explicitly rated, saved and discussed. Do not treat selected as viewed, and do not treat silence as dislike. Preserve the old feedback API while adding reason-coded optional feedback.
4. Replace implicit source penalties with explicit feedback and quality/health evidence. Exposure can be a weak, measurable denominator only when genuinely rendered/viewable; never demote for absent telemetry.
5. Stop measuring "must" simply by top-ranked relevance. A must-know needs an impact/urgency test and credible sourcing.
6. Add canonical URL normalisation and a basic event-repeat guard, but keep safe fallback when story identity is uncertain.
7. Move decorative stat/GIF/quote/image inserts out of the leading substantive count; do not let them displace the editorial story hierarchy. The existing visual language stays intact.

**Done when:** Existing sources alone produce a noticeably shorter, cleaner, non-repetitive edition; no source loses fitness simply because an edition item got no button click; legacy editions and story chats still render. Tests cover zero/short/old editions and feedback migration.

### Phase 2 — Versioned last30days adapter and source-health integrity

**Files:** new cli/src/council/scout-last30days.ts (or source adapter under cli/src/evidence/adapters/ if reused generally), scout.ts orchestration, fixture-driven tests.

1. Resolve and validate the Python >=3.12 interpreter explicitly before execution; configurable absolute executable; safe argv invocation; no shell interpolation. Health-check vendor path and compatible version/schema. Execute behind timeouts, stdout caps, nonzero-exit handling and cancellation/child cleanup.
2. Parse **agent JSON 1.4** and **discovery JSON 1.1** separately. Reject incompatible majors and malformed payloads with a clear source-health error; tolerate additive fields and valid empty results. Never fall back to guessing raw/HTML formats.
3. Preserve numeric relevance/engagement, stable IDs, timestamps, canonical URLs, upstream cluster information, usage, source_status, and optional freshness verdicts; map them into the ScoutObservation envelope.
4. Treat ok, no-results, partial, rate-limited, auth-failed, payment-required, unreachable, timeout, schema-drift, skipped-unconfigured and error differently. A missing X/TikTok/Reddit lane must not become "no discussion." Show only useful diagnostics to George; keep secrets and raw error bodies out of the surface.
5. Maintain a conservative allowlist of source backends for scheduled unattended work. No browser cookies, logged-in social sessions, unauthorized scrape workarounds or remote uploads of private corpus. Source additions are configuration/consent decisions, not autonomous permission escalation.
6. Set per-run cost/time budgets and cache effective outputs. Do not fan out into eight complete broad research runs without a budget. Surface provider usage *when reported* and "unknown" otherwise.
7. Provide compatibility fixtures for valid sparse/complete payload, unsupported major, malformed URL, missing date, unsupported source, low-score but high-engagement post, source partial failure and empty "nothing-solid" discovery.

**Done when:** Scout can ingest real pinned upstream fixtures without metadata loss; unsupported/failed engines degrade to existing RSS/HN/local evidence paths, not an empty or fabricated edition. Source state and latency are observable.

### Phase 3 — Bounded discovery: find the topics Flyd does not know yet

**Files:** new cli/src/council/scout-discovery.ts, persistence under Scout directory, existing agenda tick/scout tick.

1. Treat discovery as a separate *candidate-nomination* job, not the edition's critical path. Run bounded domain-focused discovery on a cadence with TTL caching; start with **one domain per run** and expand only after runtime measurements. Candidate beats could include creative coding, generative music, creative AI/tools, internet archaeology and experimental design, but these are seeds, not permanent keyword fences.
2. Add a constrained cross-domain/global exploration sweep less frequently to challenge the existing taste profile. A new compelling theme must be eligible even if it never appeared in the preplanned eight searches.
3. Initial integration uses the documented **one-shot JSON discovery mode**, with a written note that it relies on heuristic/engine judgment. Do not implement the full interactive three-leg protocol yet. If this produces demonstrable false positives, introduce a bounded host-judged nomination gate using existing model calls—not a new orchestration system.
4. Merge incoming nominations by source evidence and candidate name cautiously. Store confidence-floor outcome, original evidence URLs, momentum, "nothing-solid" and source coverage. No soft fallback that fills a silent day with sub-threshold junk.
5. Investigate only a small capped number of promising nominations using the shared Evidence Engine and primary/community reads. Skip cached/covered nominations unless there is a meaningful new fact.
6. Prevent concurrency collisions with the current Scout lock and a separate duration budget; keep the 3-hour watch cheap and independent. If discovery is still running when the daily edition is due, use last *completed* eligible results or proceed without them; never hold the morning edition hostage to a long multi-source scrape.

**Done when:** Offline seeded tests prove that (a) an untracked but important emerging topic enters the candidate pool, (b) an unrelated viral help-me post does not, (c) a weak single-platform spike is marked uncertain, and (d) a discovery timeout does not block a timely edition.

### Phase 4 — Event-level grouping and evidence adjudication

**Files:** new cli/src/council/scout-stories.ts plus reuse of cli/src/evidence/fusion.ts, clustering.ts, contradictions.ts and evidence types as appropriate.

1. Separate the discovery topic, the claim/event, and the articles/posts that reference it. Create event candidates by canonical URL and stable source IDs, then entity/action/time overlap. Where uncertain, avoid a destructive merge.
2. Reuse provenance and typed evidence from Flyd's Evidence Engine. Upstream clusters are **hints**, not canonical event IDs; Flyd's lexical clustering is also insufficient by itself for semantically similar headlines. Add a small bounded semantic equivalence check for borderline high-value clusters, with a deterministic fallback.
3. Count independent outlets, not raw posts or mirrors. Five syndicated articles from one press release do not provide five confirmations. Detect primary releases and reprints, preserve disagreement, and use source health in confidence calculations.
4. Separate story recurrence from *updates*: same event + no new facts => suppress; same event + material new verified fact => eligible as "Update" with prior context. Persist firstSeen/lastSeen and update history.
5. Verify central factual claims against direct release/repo/paper or independent reporting before marking confirmed. Reddit votes, model confidence, Polymarket odds and velocity are attention/context signals. Mark unknown and contradicted claims; suppress hard news claims without an evidentiary path.
6. Include a "time-to-live" or freshness rationale appropriate to the item: breaking change, ongoing trend, evergreen rabbit hole. A 30-day collection window is not an instruction to present 30-day-old events as new.

**Done when:** Tests prove that differently worded reports about one release are one story; separate releases with similar names are not merged; genuine updates return; a single-source viral claim cannot be presented as verified fact; evidence links survive transformations.

### Phase 5 — Personal editorial judgement, not keyword matching

**Files:** new cli/src/council/scout-editorial.ts; refactor rankPrompt/parsePicks in scout.ts; feedback types; editorial eval fixtures.

Use a two-stage pipeline:
1. **Cheap eligibility + diversity pass:** topical relevance floor, freshness/window, trust/provenance, event novelty, actual source quality, low-value spam/help requests, source/beat saturation, existing shown-log and user explicit negatives. Retain one protected lane for out-of-profile items with unusually strong discovery evidence.
2. **Bounded model editorial pass:** judge each shortlisted **event**, not individual links. Return structured labels and concise reasons: new fact, consequence, why-now, why-for-George, surprising connection, personal connection type, confidence, uncertainty, recommended next action (read, explore, save, watch; no execution authority), and decision (lead, include, rabbit hole, skip). Output is validated against actual evidence and project context; reject hallucinated "why" or quote.
3. Prefer substantial discoveries and unexpected intersections: tools he could use, experiments worth exploring, fresh creative methods, shifts in communities, interesting counterexamples. Do not overfit to currently active repos or force every story to mention Flyd/DIR.
4. Editorial allocation: normally **5–8** main stories; roughly 1–2 major relevant developments, 2–4 genuinely interesting finds, 0–1 strong serendipity pick and optionally 0–1 rabbit hole. These are guide rails, not hard quotas. A weak lane stays empty.
5. Preserve one unobtrusive must-know alert/day, only for a verified change with immediate consequence. No "someone is discussing X" interrupts.
6. The editorial summary must answer: "what's new?", "what is the actual insight?" and "why is it worth my attention?" without claiming a tenuous project connection. Max two short paragraphs in the article detail; one sharp sentence in the list.

**Done when:** Blind evaluation shows greater novelty and interest without a jump in false positives; story-linked provenance matches every factual lead-in; ordinary status chatter stays invisible.

### Phase 6 — Taste feedback and a living beat portfolio

**Files:** scout.ts and existing feedback endpoint/view handlers, optional new cli/src/council/scout-taste.ts.

1. Retain "more" and "less" and add optional short reasons: wrong subject, old/repeated, superficial, low-quality source, not actually new, genuinely interesting, surprise me, already knew, saved for later. Do not force a dialog/form for every tap.
2. Treat save, explicit positive/negative reaction, follow-up research and a meaningful opened story as *different* signal strengths. Passive impressions and no-click are never treated as decisive negatives; reading is not identical to liking.
3. Update subject/angle/format/novelty preferences distinct from source fitness. Keep a per-beat exploration allocation so fast feedback never closes out unfamiliar subjects completely.
4. Identify active interests from consented, bounded project/memory context, then route only minimally necessary non-sensitive search concepts outward. Never pass full private project notes, emails, customer lists, commitments or raw memory to external news APIs.
5. Maintain simple explainability: "I showed this because of X + Y," supported by known preference or explicit work relation, not inferred intimate context.
6. Include a reversible/resettable local beat history and migration of existing more/less; make no high-impact personal memory claim from a single click.

**Done when:** A reason-coded correction changes future ranking in the expected direction, unrelated beats remain available, and the model can explain each recommendation from defensible evidence.

### Phase 7 — Delivery and observation, using existing UI

**Files:** cli/src/conversation-view/page/script-today.ts, page styles/front markup only where needed, cli/src/conversation-view/activity.ts, cli/src/mobile/entry.ts/server.ts/surface.ts.

1. Reuse the existing News page, weather side and in-story "Chat about this". The story card leads with the insight; source, date and confidence are quiet supporting typography. "Why this" is one meaningful sentence, not a tag cloud.
2. Open a story into a grounded micro-dossier: short synthesis, cited primary/community sources, what's contested, prior updates and an action to investigate further. This can use the Evidence Engine's existing dossier/answer capabilities, not a new web app.
3. Keep more/less working on desktop/mobile; add feedback reasons behind an optional secondary affordance only after the data/quality effect is proven. Preserve keyboard/mobile accessible card actions.
4. Allow one "Surprise me" or Explore section without pushing decorative media into the main edition. Design should stay editorial/minimal, not a noisy livestream or conventional news portal.
5. Preserve compatibility with old EditionItem, activity stories and previous news URL-linked chat threads.

**Done when:** Desktop, mobile and text briefing show the same substantive story set; story questions have evidence and continue to work; existing stories/feedback are not broken; no new primary navigation is introduced.

### Phase 8 — Shadow, comparison and controlled cutover

1. Run old and new Scout on the *same frozen input pool* for repeatable editorial comparison. For live discovery, capture candidate observations at the time they arrive and compare on a fair time boundary; do not attribute the benefit of a new source to an unrelated ranker change.
2. Shadow-output only for at least seven daily editions, never duplicate notifications. Preserve both outputs, input hashes, costs, latency, source gaps and selection reasons. Blind judge 5–8 story lists side by side.
3. Three evaluation axes:
   - Discovery quality: fraction judged genuinely interesting, unexpected finds, breadth, usefulness, repeat-event rate and missed known-important stories.
   - Evidence quality: unsupported claim rate, source independent confirmation, freshness, dead links and misleading certainty.
   - Product/operations: edition age, time-to-ready, cost, upstream failure behaviour, user correction volume and notification intrusiveness.
4. **Proposed release gate, not measured results:** new wins >=60% of non-tied blind edition comparisons; zero high-severity false factual assertions; zero duplicate notifications; repeat-event rate lower than baseline; no source-health failures silently reported as "nothing found"; p95 edition preparation within the *measured* current operating budget; no uncontrolled model/API spend.
5. Launch flags: FLYD_SCOUT_DISCOVERY=0|shadow|on; FLYD_SCOUT_EDITORIAL=legacy|shadow|on; one environment switch instantly restores the legacy path while preserving the new candidate cache. Implement defaults conservatively, then graduate only after gate.
6. Rollout order: local shadow -> new curation for owner only -> routine on -> retire unnecessary overlapping old topic searches after two stable weeks.
7. Observe for several cycles, then consider richer three-leg host-judged discovery **only if** its candidate precision exceeds the headless path enough to justify extra latency/cost.

**Done when:** Every release gate is met and failure injection still produces a correct, bounded edition or a truthful empty/degraded state. No claim that the feature is "done" until this evidence exists.

## 5. Prioritised work slices and dependencies

| Slice | Depends on | Key deliverable | Tests |
| --- | --- | --- | --- |
| S0 Baseline diagnostics and local version preflight | None | Scout status/fixtures + diagnosed engine | offline snapshot; version/broken sources |
| S1 Short edition, truthful exposure and source feedback | S0 | Better existing Scout with no new source | candidate/feedback/dedupe/UX compatibility |
| S2 Last30days typed adapter | S0 | Agent 1.4 + discovery 1.1 parsing, metadata, health | contract fixtures; schema drift; failures; timeouts |
| S3 Cached bounded discovery nomination | S2 | Novel sources and candidates without slowing morning | nothing-solid; junk; covered; concurrency |
| S4 Event grouping/evidence checks | S2 + S3 | Story IDs, source evidence, verified updates | syndicated duplicates; nonmerge; contradictions |
| S5 Editorial selection | S1 + S4 | 5–8 excellent stories with genuine why | blind fixture rubric; no hallucination |
| S6 Taste/beat learning | S1 + S5 | Subject/angle corrections + exploration budget | explicit vs implicit; reversible |
| S7 Desktop/mobile presentation | S4 + S5 | Grounded cards and story drilldown | existing page/mobile/story-chat tests |
| S8 Shadow evaluation/cutover | all | Evidence-based switch to new Scout | golden corpus, regressions, p95/cost, rollback |

**Critical path:** S0 → S2 → S3 → S4 → S5 → S8. S1 is an early independent win; S6 and S7 should not delay the first shadow comparison. Do not parallelise code that owns the same Scout state/lock without an explicit schema contract and integration owner.

## 6. Test matrix and acceptance detail

- **Contracts:** valid agent 1.4, discovery 1.1, incomplete optional fields, unknown future minor, unsupported major, comparison envelope, raw profile mistaken for agent, remote API incompatibility, zero results, malformed JSON, overlarge stdout, prompt injection in source text, safe URL validation.
- **Source health:** success; no-results; partial; rate-limited; payment-required; unavailable; auth-failed; timeouts; disk/network failure; mixed good/bad source runs. Verify local errors never expose secrets in surfaces.
- **Temporal:** wrong time zone, future timestamp, missing publishedAt, 30-day window, update to old story, stale candidate reappearing, cache TTL, multiple tick invocations, stalled discovery and lock recovery.
- **Identity:** same event from Reddit/GitHub/blog, two separate model releases, "AI" false-positive token overlap, syndicated press copies, story already shown with new verified change, familiar headline with different facts, unicode punctuation.
- **Ranking:** viral off-topic source; genuinely important niche with low engagement; new creative subject far from profile; already-liked source with dull story; competitor headline with no user relevance; real urgent API breaking change; contradictory source claims; strong rabbit hole.
- **Learning:** positive/negative reason-coded feedback; explicit dislike vs absence of click; source fitness unaffected by unrendered selected items; muted subject vs unrelated recommendation; feedback replay; reset/migration.
- **UI:** desktop News, mobile News, Today cards, talk-about-story, image handling, URL security, compact responsive cards, accessibility, old edition payload.
- **Privacy/authority:** scheduled research uses source-scoped egress consent, does not consult unconsented communications, does not access logged-in social sessions, does not create general memory facts, does not send/publish/perform side effects beyond existing authorized news notifications.
- **Operations:** bounded CPU/wall-time/tokens/queries, backoff/credit exhaustion, no orphan processes, stable cache, no missed next agenda tick, fair legacy vs shadow input pool.

Run CLI checks from cli/: npm run lint; npm test -- src/council/__tests__/scout.test.ts (plus new Scout/evidence/view/mobile suites); npm run build. Follow full test suite before cutover. Confirm exact test invocation against installed Vitest flags, and collect actual output; a written plan is not evidence that any tests passed.

## 7. Operational limits and failure behaviour

Initial budget values below are rollout defaults to tune from S0 measurements, not promises about upstream performance:
- 1 discovery domain per scheduled run; 1 concurrent upstream discovery process; bounded nominations; investigate at most 3 promising discoveries per run.
- Reuse cached nominations until TTL; no duplicate same-day requery by edition and watch.
- Per-source and total wall-clock caps; timeout yields degraded coverage and leaves last completed cache, never holds the morning edition.
- Separate small editorial-model budget from discovery-engine budget; admit "cost unknown" rather than zero.
- Global 3-hour watch remains feed-first and cheap; never schedule full discovery on every watch.
- Existing lock, Core tick, model backoff and stop switches remain authoritative.
- No cookies or browser session reads; configurable source opt-ins require explicit user consent under existing capability/egress rules.
- Disable discovery or editorial flags to revert. Do not roll back data schema destructively.

## 8. Strongest objections and countermeasures

**"Upstream trending is mostly noise."** Correct. Its job is nomination, not publication. Junk filters, primary confirmation, personal-interest review and an absolute editorial bar happen *after* discovery. A correct result is sometimes no story.

**"This doubles the news machinery."** Do not introduce a second evidence store, ranker or agent team. New code is a thin adapter + Scout-specific event/editorial rules, sharing Evidence Engine provenance/read and existing schedules. Reject reuse of upstream ranking as final authority.

**"Discovery costs more and makes mornings slow."** Discovery has its own scheduler/cache/budget and cannot block the daily edition. Baseline and shadow tests are required before removing old searches.

**"Personalisation will make a filter bubble."** Reserve a bounded exploratory lane, retain serendipity evidence, use negative feedback as explicit preference only, and review subject diversity over weeks.

**"Event clustering could silently erase real news."** Prefer false splits over false merges when uncertain, store lineage and all evidence, and maintain an explicit 'substantive update' path.

**"The tests will simply reward headlines that sound clever."** Evaluate actual article evidence and relevance, not just headline attractiveness; include false claims, background familiarity, and missed must-knows in the frozen evaluation set. Human blind judgments remain the main product-quality gate.

## 9. First implementation checkpoint

Before building the larger discovery stages, deliver S0 + S1 + S2 in one reviewed change sequence:

1. A diagnostic command showing which last30days executable, Python version, schema, source health, spend and wall time Scout actually uses.
2. A 5–8 item default edition and honest non-exposure-based preference learning, with old UX and feedback unchanged.
3. A versioned adapter that preserves agent and discovery evidence and has failure/compatibility tests.
4. A frozen local evaluation set and shadow comparison harness.

Review those artifacts and measurements before S3. This avoids investing in more retrieval when the principal bottleneck may be editorial judgment, source failure or slow scheduling.

### Definition of complete

Flyd reliably finds and selects interesting *events*, including some George would not have searched for; delivers 5–8—or fewer if the world is quiet—with defensible relevance and supporting evidence; adapts correctly to explicit feedback; preserves user privacy and provenance; runs inside measured budgets; and beats the legacy edition in blind comparisons. Implementation remains **not started** until code, tests and rollout are executed.

THE ONE THING TO DO NEXT: Implement S0 diagnostics and a frozen evaluation corpus, then ship S1 and S2 before adding discovery.