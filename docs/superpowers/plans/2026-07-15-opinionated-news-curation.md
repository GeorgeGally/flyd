# Opinionated News Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three design feeds and make Flyd comparatively judge every news batch against an explicit personal taste profile before stories become discovery evidence.

**Architecture:** `WebDiscovery::CandidatePool` performs bounded deterministic hygiene and source diversity. `Flyd::TasteCurator` owns one structured LLM judgment over the batch. `RefreshWebDiscoveryJob` persists only accepted judgments and retains the previous snapshot when curation fails.

**Tech Stack:** Rails 8, Active Job, Ruby, `Llm::Chat`, PostgreSQL-backed intelligence snapshots, Minitest.

---

### Task 1: Add The Publisher Feeds

**Files:**
- Modify: `config/news_feeds.yml`
- Modify: `test/services/web_discovery/feed_catalog_test.rb`

- [ ] **Step 1: Write the failing catalog assertions**

Add assertions for:

```ruby
assert_includes urls, "https://feeds.feedburner.com/core77/blog"
assert_includes urls, "https://flowingdata.com/feed"
assert_includes urls, "https://feeds.feedburner.com/design-milk"
assert_equal urls.uniq, urls
```

- [ ] **Step 2: Run the catalog test and verify it fails**

Run: `bin/rails test test/services/web_discovery/feed_catalog_test.rb`

- [ ] **Step 3: Add the three unique publisher records**

Use `design` for Core77 and Design Milk, and `data_visualization` for FlowingData.

- [ ] **Step 4: Run catalog and parser tests**

Run: `bin/rails test test/services/web_discovery/feed_catalog_test.rb test/services/web_discovery/feed_client_test.rb`

### Task 2: Build A Bounded Candidate Pool

**Files:**
- Create: `app/services/web_discovery/candidate_pool.rb`
- Create: `test/services/web_discovery/candidate_pool_test.rb`

- [ ] **Step 1: Write failing tests for hygiene, recency, deduplication, and source diversity**

The public contract is:

```ruby
stories = WebDiscovery::CandidatePool.new(raw_stories, limit: 40).call
```

Assert that entries require an ID, title, HTTPS/HTTP URL, and timestamp no older than seven days; duplicate URLs and normalized titles collapse; and distinct sources appear before repeated sources.

- [ ] **Step 2: Run the test and verify the constant is missing**

Run: `bin/rails test test/services/web_discovery/candidate_pool_test.rb`

- [ ] **Step 3: Implement the candidate pool**

Use `URI.parse` for URLs, normalized lowercase titles for duplicate detection, `published_at` for recency, and a stable freshness/score ordering. Do not use taste keywords here.

- [ ] **Step 4: Run the candidate-pool test**

Run: `bin/rails test test/services/web_discovery/candidate_pool_test.rb`

### Task 3: Implement Flyd's Comparative Taste Judgment

**Files:**
- Create: `app/services/flyd/taste_curator.rb`
- Create: `test/services/flyd/taste_curator_test.rb`

- [ ] **Step 1: Write failing curator tests**

Inject a fake chat response and assert this result shape:

```ruby
[
  story.merge(
    interest_verdict: "hot",
    interest_reason: "A strange constrained hardware experiment.",
    rabbit_hole: true
  )
]
```

Cover `hot`, `worth_a_look`, and `skip`; exactly one accepted rabbit hole; unknown IDs; duplicate judgments; missing reasons; malformed JSON; and inclusion of concise personal context in the user message.

- [ ] **Step 2: Run the curator test and verify it fails**

Run: `bin/rails test test/services/flyd/taste_curator_test.rb`

- [ ] **Step 3: Implement `Flyd::TasteCurator`**

The constructor accepts `stories:`, `context:`, `chat: Llm::Chat.new`, and `limit: 8`. Send one system prompt containing the approved taste profile and a JSON user message containing candidate keys plus concise evidence. Parse the first JSON object, validate every accepted judgment, reject unrecognized or duplicated keys, require one accepted rabbit hole when any item is accepted, and return rabbit hole first followed by `hot` and `worth_a_look` in model order.

- [ ] **Step 4: Run curator tests**

Run: `bin/rails test test/services/flyd/taste_curator_test.rb`

### Task 4: Replace Keyword Ranking In The Refresh Pipeline

**Files:**
- Modify: `app/jobs/refresh_web_discovery_job.rb`
- Modify: `test/jobs/refresh_web_discovery_job_test.rb`
- Modify: `app/services/flyd/evidence_candidates.rb`
- Modify: `test/services/flyd/evidence_candidates_test.rb`
- Delete: `app/services/web_discovery/topic_profile.rb`
- Delete: `test/services/web_discovery/topic_profile_test.rb`

- [ ] **Step 1: Rewrite the refresh-job test around curated output**

Stub `candidate_pool` and `taste_curator`. Assert skipped stories are absent and accepted evidence contains:

```ruby
"interestVerdict" => "hot"
"interestReason" => "A strange constrained hardware experiment."
"rabbitHole" => true
```

- [ ] **Step 2: Run the job test and verify it fails**

Run: `bin/rails test test/jobs/refresh_web_discovery_job_test.rb`

- [ ] **Step 3: Wire the background job**

Call `CandidatePool`, then `TasteCurator`, then enrich only accepted stories with `PageMetadata`. Set evidence confidence to `0.9` for `hot` and `0.82` for `worth_a_look`. Remove `matchedTopics` and keyword-derived relevance fields. Let curator exceptions reach the existing failure path so the last usable snapshot remains active.

- [ ] **Step 4: Prioritize internal curation metadata**

In `Flyd::EvidenceCandidates#discovery_score`, add a large rabbit-hole bonus, then `hot`, then `worth_a_look`. Keep this metadata out of the renderer.

- [ ] **Step 5: Remove the obsolete keyword profile**

Delete `WebDiscovery::TopicProfile` and its tests after confirming no references remain with:

```bash
rg -n "TopicProfile|matchedTopics|relevanceReason" app test
```

- [ ] **Step 6: Run focused integration tests**

Run: `bin/rails test test/jobs/refresh_web_discovery_job_test.rb test/services/flyd/evidence_candidates_test.rb test/services/flyd/taste_curator_test.rb test/services/web_discovery/candidate_pool_test.rb`

### Task 5: Verify And Ship On Main

**Files:**
- Verify all modified files

- [ ] **Step 1: Verify all requested live feeds normalize**

Run a Rails runner over Core77, FlowingData, and Design Milk with `per_source_limit: 1`; each source must return a title.

- [ ] **Step 2: Run complete verification**

Run:

```bash
bin/rails test
bin/rails test:system
bin/rubocop
git diff --check
```

- [ ] **Step 3: Commit and push main**

Commit the implementation with `feat: curate news through Flyd taste` and push `origin main`.
