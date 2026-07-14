# Living Discovery Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static one-story discovery page with a grounded, moving composition of recent work, the user's horoscope, and several current stories.

**Architecture:** Add bounded background producers for RSS/Atom, local project activity, and horoscope content, then persist their observations through intelligence providers. Expand discovery composition to three grounded objects and render them as an asymmetric fixed-stage poster deck with client-side focus transitions.

**Tech Stack:** Rails 8, Active Job, PostgreSQL intelligence snapshots, Nokogiri, Hotwire/Stimulus, Tailwind CSS, Minitest, Capybara/Selenium.

---

### Task 1: Feed catalog and parser

**Files:**
- Create: `config/news_feeds.yml`
- Create: `app/services/web_discovery/feed_catalog.rb`
- Create: `app/services/web_discovery/feed_client.rb`
- Create: `test/services/web_discovery/feed_catalog_test.rb`
- Create: `test/services/web_discovery/feed_client_test.rb`

- [ ] Write tests proving every requested publisher and subreddit URL is present, RSS and Atom entries normalize to the existing story contract, IDs are stable, and one failed feed does not fail the batch.
- [ ] Run the focused tests and confirm they fail because the catalog and client do not exist.
- [ ] Implement the fixed catalog, bounded HTTPS transport, feed parsing, per-source limits, and isolated failures.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Mixed-source discovery refresh

**Files:**
- Modify: `app/jobs/refresh_web_discovery_job.rb`
- Modify: `app/services/web_discovery/topic_profile.rb`
- Modify: `test/jobs/refresh_web_discovery_job_test.rb`
- Modify: `test/services/web_discovery/topic_profile_test.rb`

- [ ] Write tests proving Hacker News and feed stories are merged, ranked, source-diversified, enriched only after selection, and persisted with exact source metadata.
- [ ] Run the focused tests and confirm the new expectations fail.
- [ ] Inject the feed client into the refresh job and make topic selection preserve source diversity.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Personal context provider

**Files:**
- Create: `app/services/local_activity/scanner.rb`
- Create: `app/services/horoscope/client.rb`
- Create: `app/services/intelligence_state/personal_context_provider.rb`
- Create: `app/jobs/refresh_personal_context_job.rb`
- Modify: `app/services/intelligence_state/registry.rb`
- Modify: `app/jobs/schedule_intelligence_refresh_job.rb`
- Modify: `config/flyd.yml`
- Create: `test/services/local_activity/scanner_test.rb`
- Create: `test/services/horoscope/client_test.rb`
- Create: `test/services/intelligence_state/personal_context_provider_test.rb`
- Create: `test/jobs/refresh_personal_context_job_test.rb`

- [ ] Write tests proving recent Git/file activity and current Aries content become typed observations without request-time work.
- [ ] Run the focused tests and confirm they fail because the provider does not exist.
- [ ] Implement bounded local scanning, fixed-host horoscope parsing, snapshot persistence, scheduling, and registry inclusion.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Three-object discovery direction

**Files:**
- Modify: `app/services/flyd/evidence_candidates.rb`
- Modify: `app/services/flyd/interface_director.rb`
- Modify: `app/services/flyd/ground_discovery.rb`
- Modify: `app/services/flyd/surface_plan_validator.rb`
- Modify: `app/services/flyd/intelligence.rb`
- Modify: `test/services/flyd/evidence_candidates_test.rb`
- Modify: `test/services/flyd/ground_discovery_test.rb`
- Modify: `test/services/flyd/surface_plan_validator_test.rb`

- [ ] Write tests proving fresh activity, horoscope, and news references produce up to three distinct grounded objects and that external news cannot mechanically displace recent personal work.
- [ ] Run the focused tests and confirm the single-item behavior fails the expectations.
- [ ] Expand the discovery grammar, selection, grounding, and validation while preserving the three-object attention budget.
- [ ] Run the focused tests and confirm they pass.

### Task 5: Living poster stage and quiet provenance

**Files:**
- Modify: `app/views/surfaces/_plane.html.erb`
- Modify: `app/views/surfaces/renderers/_discovery_scene.html.erb`
- Modify: `app/javascript/controllers/surface_controller.js`
- Modify: `app/assets/tailwind/application.css`
- Modify: `test/system/directed_surface_modes_test.rb`

- [ ] Write a system test proving three poster objects share one viewport, focus can move, no `Evidence` or engagement text appears, source posters remain actionable, and desktop/mobile do not scroll.
- [ ] Run the system test and confirm it fails against the static article presentation.
- [ ] Implement the asymmetric poster deck, focus transitions, keyboard/pointer behavior, reduced-motion handling, and stripped primary chrome.
- [ ] Run the system test and confirm it passes.

### Task 6: Live refresh and verification

**Files:**
- Modify only files required by defects found during verification.

- [ ] Refresh personal context and web discovery snapshots against live sources.
- [ ] Compose and activate a real surface.
- [ ] Verify desktop and mobile screenshots, image rendering, focus transitions, no overlap, and no document scrolling.
- [ ] Run `bin/rails test`, `bin/rails test:system`, `bin/rubocop`, `bin/brakeman --no-pager`, `git diff --check`, and `cd cli && npm test`.
- [ ] Commit the verified implementation and push `main`.
