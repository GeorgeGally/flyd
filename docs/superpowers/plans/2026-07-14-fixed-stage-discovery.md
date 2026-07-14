# Fixed Stage And Grounded Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the page-like root with the approved fixed-stage interface and make Flyd surface useful personal discoveries and fresh relevant news instead of claiming that a rich evidence state is empty.

**Architecture:** Keep `Surface` and `SurfaceItem` as the persisted semantic boundary. Add fixed responsive stage compositions and media-bound decision options at rendering time. Add a strict `discovery` surface grammar fed by high-confidence personal evidence and a persisted Hacker News provider; urgent decision, investigation, action, and monitoring candidates continue to outrank discovery.

**Tech Stack:** Rails 8, Hotwire/Stimulus, Tailwind CSS, PostgreSQL JSONB snapshots, Active Storage, Ruby `Net::HTTP`, official Hacker News API, Minitest, Capybara/Selenium.

---

## File Map

- Modify `app/views/layouts/application.html.erb`: lock root surfaces to `100dvh`.
- Modify `app/views/surfaces/show.html.erb`: create the persistent stage shell, context edge, and recessed intent tray.
- Modify `app/views/surfaces/_plane.html.erb`: map semantic modes to fixed-stage compositions.
- Modify `app/views/surfaces/_intent_field.html.erb`: compact launcher/tray controls.
- Modify `app/views/surfaces/renderers/_decision_scene.html.erb`: render validated option media as the dominant objects.
- Create `app/views/surfaces/renderers/_discovery_scene.html.erb`: render one grounded personal or current discovery.
- Modify `app/assets/tailwind/application.css`: implement fixed-stage geometry and mobile scene paging.
- Modify `app/javascript/controllers/surface_controller.js`: open and close the intent tray without document reflow.
- Modify `app/services/flyd/surface_plan_validator.rb`: validate media-bound options and discovery metadata.
- Modify `app/services/surface_renderers/registry.rb`: register `discovery_scene`.
- Modify `app/services/flyd/evidence_candidates.rb`: derive rotating grounded discovery candidates.
- Modify `app/services/flyd/interface_director.rb`: add discovery below directed work and above quiet.
- Modify `app/services/flyd/intelligence.rb`: add the strict discovery plan grammar and truthful fallback copy.
- Create `app/services/intelligence_state/web_discovery_provider.rb`: persist and expose web discoveries.
- Create `app/services/web_discovery/hacker_news_client.rb`: fetch bounded stories from the fixed official API host.
- Create `app/services/web_discovery/topic_profile.rb`: derive interest terms from the local CLI snapshot.
- Create `app/jobs/refresh_web_discovery_job.rb`: refresh persisted web evidence outside requests.
- Modify `app/services/intelligence_state/registry.rb`: expose CLI and web snapshots together.
- Modify `app/jobs/schedule_intelligence_refresh_job.rb`, `app/controllers/surfaces_controller.rb`, and `config/sidekiq.yml`: enqueue web refresh without blocking `GET /`.
- Create `app/services/surface_source_resolver.rb`: resolve local and multi-provider source references and safe external links.
- Modify `app/controllers/surface_item_sources_controller.rb`: use the shared resolver.
- Modify system, service, controller, and job tests listed below.

### Task 1: Lock The Root To One Stage

**Files:**
- Modify: `test/system/directed_surface_modes_test.rb`
- Modify: `test/system/surface_experience_test.rb`
- Modify: `app/views/layouts/application.html.erb`
- Modify: `app/views/surfaces/show.html.erb`
- Modify: `app/views/surfaces/_plane.html.erb`
- Modify: `app/views/surfaces/_intent_field.html.erb`
- Modify: `app/assets/tailwind/application.css`
- Modify: `app/javascript/controllers/surface_controller.js`

- [ ] **Step 1: Write failing fixed-stage system tests**

Assert at 1440x900 and 390x844 that `document.scrollingElement.scrollHeight <= window.innerHeight`, the scene owns a bounded `.flyd-stage__scene`, context appears at the lower edge, and opening the intent tray does not change document height.

- [ ] **Step 2: Run the tests and verify RED**

Run: `bin/rails test:system test/system/directed_surface_modes_test.rb test/system/surface_experience_test.rb`

Expected: failures because the surfaces layout uses `min-h-screen`, the root body can scroll, and the intent field participates in normal document flow.

- [ ] **Step 3: Implement the stage shell**

Use a `100dvh` grid with identity, scene, and context regions. Keep the body and root overflow hidden. Move the intent form into an absolute tray controlled by `data-intent-active`; the wordmark dot and `/` key open it, Escape closes it, and focus returns to the launcher.

- [ ] **Step 4: Implement stage-responsive compositions**

Use asymmetric desktop grids. On mobile, show one semantic object at a time inside the stage and provide explicit previous/next controls when multiple objects exist. Allow bounded internal scrolling only for content renderers that require it.

- [ ] **Step 5: Run focused tests and commit**

Run: `bin/rails test:system test/system/directed_surface_modes_test.rb test/system/surface_experience_test.rb`

Commit: `feat(surface): Build the fixed stage shell`

### Task 2: Restore Real Objects To Decisions

**Files:**
- Modify: `test/services/flyd/surface_plan_validator_test.rb`
- Modify: `test/system/directed_surface_modes_test.rb`
- Modify: `app/services/flyd/surface_plan_validator.rb`
- Modify: `app/services/flyd/intelligence.rb`
- Modify: `app/views/surfaces/renderers/_decision_scene.html.erb`
- Modify: `app/assets/tailwind/application.css`

- [ ] **Step 1: Write failing media-option tests**

Create two image `IntentAttachment` records. Validate decision metadata containing:

```ruby
{
  "options" => [
    { "id" => "dark", "label" => "Dark poster", "description" => "Evening market", "attachment_id" => dark.id },
    { "id" => "bright", "label" => "Bright poster", "description" => "Family fair", "attachment_id" => bright.id }
  ]
}
```

Assert that each attachment id must appear in `source_refs`, both images render, the recommended image is first, and neither alternative is wrapped in a decorative card.

- [ ] **Step 2: Run tests and verify RED**

Run: `bin/rails test test/services/flyd/surface_plan_validator_test.rb && bin/rails test:system test/system/directed_surface_modes_test.rb`

Expected: metadata drops `attachment_id` and the decision renderer emits no images.

- [ ] **Step 3: Validate and render bound media**

Retain an optional `attachment_id` per option only when an exact `intent_attachment:<id>` source exists. Resolve available attachments in the renderer and display them with `object-fit: contain`, stable aspect constraints, meaningful alt text, and textual fallback.

- [ ] **Step 4: Match the approved decision hierarchy**

Use the baseline composition: direction/action rail on the left, real alternatives filling the work field, recommendation label above the first object, yellow primary accept action, secondary explanation action, and context at the lower edge.

- [ ] **Step 5: Run tests and commit**

Run: `bin/rails test test/services/flyd/surface_plan_validator_test.rb && bin/rails test:system test/system/directed_surface_modes_test.rb`

Commit: `feat(surface): Manifest real decision objects`

### Task 3: Add Grounded Personal Discovery

**Files:**
- Modify: `test/services/flyd/evidence_candidates_test.rb`
- Modify: `test/services/flyd/interface_director_test.rb`
- Modify: `test/services/flyd/surface_plan_validator_test.rb`
- Modify: `test/services/surface/planner_test.rb`
- Modify: `app/services/flyd/evidence_candidates.rb`
- Modify: `app/services/flyd/interface_director.rb`
- Modify: `app/services/flyd/surface_plan_validator.rb`
- Modify: `app/services/flyd/intelligence.rb`
- Modify: `app/services/surface_renderers/registry.rb`
- Create: `app/views/surfaces/renderers/_discovery_scene.html.erb`

- [ ] **Step 1: Write failing discovery tests**

Prove that a high-confidence observed report or archive event can create a `discovery` candidate, that the previous surface source is excluded so discovery rotates, and that action, decision, investigation, and monitoring still outrank discovery. Prove that ungrounded generated nudges cannot create discovery.

- [ ] **Step 2: Run tests and verify RED**

Run: `bin/rails test test/services/flyd/evidence_candidates_test.rb test/services/flyd/interface_director_test.rb test/services/flyd/surface_plan_validator_test.rb test/services/surface/planner_test.rb`

Expected: `discovery` is not a supported mode and report/event evidence currently yields quiet.

- [ ] **Step 3: Implement the discovery grammar**

Add `discovery` to mode registries with exactly one foreground `discovery_scene` item, at least one exact source reference, and metadata containing only `why_it_matters` and `source_label`. The prompt must distinguish personal rediscovery from current web news and must not invent facts, dates, or links.

- [ ] **Step 4: Remove the empty-state cop-out**

Only return literal empty quiet when the compiled state contains no eligible directed or discovery evidence. Use truthful quiet copy such as `Flyd is ready when you are.` without claiming that Flyd knows nothing. Rich state must go through Flyd judgment rather than the hard-coded quiet shortcut.

- [ ] **Step 5: Run tests and commit**

Run: `bin/rails test test/services/flyd/evidence_candidates_test.rb test/services/flyd/interface_director_test.rb test/services/flyd/surface_plan_validator_test.rb test/services/surface/planner_test.rb`

Commit: `feat(surface): Surface grounded personal discoveries`

### Task 4: Add Fresh Web Discovery

**Files:**
- Create: `test/services/intelligence_state/web_discovery_provider_test.rb`
- Create: `test/services/web_discovery/hacker_news_client_test.rb`
- Create: `test/services/web_discovery/topic_profile_test.rb`
- Create: `test/jobs/refresh_web_discovery_job_test.rb`
- Modify: `test/controllers/surfaces_controller_test.rb`
- Create: `app/services/intelligence_state/web_discovery_provider.rb`
- Create: `app/services/web_discovery/hacker_news_client.rb`
- Create: `app/services/web_discovery/topic_profile.rb`
- Create: `app/jobs/refresh_web_discovery_job.rb`
- Modify: `app/services/intelligence_state/registry.rb`
- Modify: `app/jobs/schedule_intelligence_refresh_job.rb`
- Modify: `app/controllers/surfaces_controller.rb`
- Modify: `config/flyd.yml`
- Modify: `config/sidekiq.yml`

- [ ] **Step 1: Write failing provider and client tests**

Stub the fixed official endpoints `https://hacker-news.firebaseio.com/v0/topstories.json` and `/v0/item/<id>.json`. Assert bounded timeouts, story count, HTTPS links, observation status, stable `discovery:hn:<id>` ids, and graceful retention of the last usable snapshot on failure.

- [ ] **Step 2: Write failing relevance tests**

Supply local goals, reports, signals, and recent-event topics. Assert that title matches receive a relevance reason while a high-ranked unmatched story remains eligible as serendipity. No model call is used for collection or ranking.

- [ ] **Step 3: Implement persisted web discovery**

Fetch at most 20 top ids and retain at most 8 stories. Persist a `web-discovery` `IntelligenceSnapshot` with a two-hour freshness window. Include title, canonical URL, Hacker News discussion URL, author, score, comment count, publication time, matched topics, and relevance reason.

- [ ] **Step 4: Schedule outside the request path**

Enqueue CLI and web refreshes from the scheduler. `GET /` may only enqueue missing or stale work; it never performs network I/O or composition synchronously. Web failure remains visible in provider health and never erases the last usable snapshot.

- [ ] **Step 5: Run tests and commit**

Run: `bin/rails test test/services/intelligence_state/web_discovery_provider_test.rb test/services/web_discovery test/jobs/refresh_web_discovery_job_test.rb test/controllers/surfaces_controller_test.rb`

Commit: `feat(intelligence): Add fresh web discoveries`

### Task 5: Resolve And Open Exact Sources

**Files:**
- Create: `test/services/surface_source_resolver_test.rb`
- Modify: `test/controllers/surface_item_sources_controller_test.rb`
- Create: `app/services/surface_source_resolver.rb`
- Modify: `app/controllers/surface_item_sources_controller.rb`
- Modify: `app/views/surfaces/renderers/_discovery_scene.html.erb`
- Modify: `app/views/surface_item_sources/show.html.erb`

- [ ] **Step 1: Write failing multi-provider source tests**

Create CLI and web snapshots referenced by one surface. Assert exact reference resolution from the snapshot ids stored on that surface, safe `http`/`https` external links, rejection of other schemes, and no fallback to newer unrelated snapshots.

- [ ] **Step 2: Run tests and verify RED**

Run: `bin/rails test test/services/surface_source_resolver_test.rb test/controllers/surface_item_sources_controller_test.rb`

Expected: the controller currently searches only the CLI snapshot.

- [ ] **Step 3: Implement shared source resolution**

Resolve local records first, then only the exact provider snapshots recorded on the surface. Expose safe external source and discussion links to the discovery renderer and a readable evidence view.

- [ ] **Step 4: Run tests and commit**

Run: `bin/rails test test/services/surface_source_resolver_test.rb test/controllers/surface_item_sources_controller_test.rb`

Commit: `fix(surface): Resolve exact discovery sources`

### Task 6: Compose And Verify The Real Product

**Files:**
- Modify only files required by failures found during acceptance.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
bin/rails test
bin/rails test:system
bin/rubocop
bin/brakeman --no-pager
git diff --check
```

- [ ] **Step 2: Refresh actual local and web evidence**

Run:

```bash
bin/rails runner 'RefreshIntelligenceStateJob.perform_now; RefreshWebDiscoveryJob.perform_now'
bin/rails runner 'ComposeSurfaceJob.perform_now(reason: "fixed_stage_acceptance")'
```

Assert that a rich state does not activate `quiet:available`, every displayed fact has exact source refs, and provider timestamps are fresh.

- [ ] **Step 3: Verify the browser at desktop and mobile**

At 1440x900 and 390x844 verify nonblank rendered objects, no root document scrolling, no overlaps, intent-tray focus behavior, source opening, and distinct scene composition. Capture screenshots for both sizes.

- [ ] **Step 4: Commit acceptance fixes and push `main`**

Commit: `fix(surface): Complete fixed stage acceptance`

Verify local `main` and `origin/main` have the same commit and the worktree is clean.
