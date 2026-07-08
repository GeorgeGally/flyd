---
title: Wire real LLM calls into intelligence subsystems
type: feat
status: completed
date: 2026-07-08
---

# Wire real LLM calls into intelligence subsystems

## Summary

Replace the six hardcoded stubs in MemoryEngine, BeliefEngine, BehaviourEngine, LlmStreamingJob, and OpencodeBuildJob with real LLM provider calls so the app actually learns from conversations and can execute builds. Also configure sidekiq-cron to run recurring synthesis jobs.

---

## Problem Frame

Flyd V1 has a complete chat UI, LLM streaming, database models for decisions/beliefs/behaviours, and background jobs — but the intelligence subsystems all return hardcoded placeholder values. No decisions are extracted from conversations. No beliefs are synthesized. No behaviour patterns are detected. The LLM never sees project context. Builds always "succeed" with canned output. Without these wires connected, the app is a chat UI with no persistent intelligence.

---

## Requirements

- R1. Extract decisions from conversations via LLM call with structured JSON prompt
- R2. Synthesize beliefs from extracted decisions, grouped by LLM-extracted topic
- R3. Detect contradictions between new decisions and existing beliefs via LLM
- R4. Extract behaviour trigger phrases from decision sequences via LLM
- R5. Inject learned context (decisions, beliefs, matching behaviours) into the chat system prompt
- R6. Execute opencode builds via subprocess (Open3) with context file, parse JSON result
- R7. Schedule BeliefSynthesisJob (hourly), CaptureWatcherJob (5 min), BackupJob (daily) via sidekiq-cron

---

## Scope Boundaries

- Decision extraction confidence scoring remains a simple fixed value (0.6) — no LLM-based uncertainty estimation
- Token counting remains the rough `(text.length / 4.0).ceil` estimate — no tiktoken integration
- Belief topic extraction uses an LLM prompt, not an NLP library — keeps gem dependencies minimal
- Behaviour patterns are extracted per-sequence via LLM — no cross-sequence clustering or timeseries analysis
- QMD sidecar integration is not included — search-dependent features continue to return empty results
- UI for viewing/managing decisions/beliefs/behaviours is not included — this plan wires the backend learning loop only

### Deferred to Follow-Up Work

- Opencode build output rendered in the chat UI with streaming feedback — future iteration
- Cross-project belief synthesis (currently scoped per-project)

---

## Context & Research

### Relevant Code and Patterns

- `lib/llm/provider.rb` — existing Provider/OpenaiProvider/AnthropicProvider classes with streaming support. New `Llm::Chat` wrapper will reuse these.
- `lib/subsystems/memory_engine.rb` — `call_llm` stub at line 77-79 returns `"[]"`. Decision extraction prompt at lines 18-25 already structured for JSON output. `inject_context_into_prompt` at line 43 already has the right shape for R5.
- `lib/subsystems/belief_engine.rb` — `potentially_contradicts?` stub at line 53-55 returns `false`. `extract_topic` stub at line 36-38 takes first 3 words.
- `lib/subsystems/behaviour_engine.rb` — `extract_trigger` stub at line 40-44 takes first 4 words.
- `app/jobs/llm_streaming_job.rb` — `system_prompt` at line 39-46 is static. `MemoryEngine#inject_context_into_prompt` already exists to inject context.
- `app/jobs/opencode_build_job.rb` — `execute_opencode` stub at line 45-47 returns `mock_build_result`. `build_context` at line 30-42 already constructs context.
- `lib/flyd/key_loader.rb` — reads API keys from `~/.flyd/config.json` + ENV. Has `default_model` method.
- `config/flyd.yml` — app config loaded into `Rails.configuration.flyd`

### Institutional Learnings

- AGENTS.md documents that `.js` import extensions are required in `.ts` files (NodeNext). Not relevant here (Rails app).
- Tests **must** use `vi.mock` for config-dependent tests (TypeScript CLI). Rails tests use `ActiveSupport::TestCase` without mocking.
- The `sidekiq-cron` gem is in the Gemfile but no schedule is configured.

---

## Key Technical Decisions

- **Create `Llm::Chat` service** for subsystem LLM calls: Wraps `Llm::Provider` with a `chat(messages)` method that returns the full response text. Separate from the streaming path used by `LlmStreamingJob`. Accepts a model parameter defaulting to `gpt-4.1-nano` (configurable via `flyd.yml` extraction_model). Errors raise `Llm::Chat::Error` for callers to handle.
- **Extraction model separate from chat model**: Backend extraction/synthesis calls use a cheaper default model (`gpt-4.1-nano`), independent of the user's configured default chat model. Child subsystems that need only classification (contradiction, topic) can prompt for 1-5 word responses, using minimal tokens.
- **Topic extraction via LLM prompt**: Ask the LLM "what topic does this decision relate to? Answer in 1-3 words." instead of adding an NLP library. This costs a few hundred tokens per call but keeps dependencies minimal and produces meaningful topics.
- **Sidekiq-cron YAML config**: Use `config/sidekiq.yml` with `:scheduler:` key for cron schedule definitions rather than Ruby initializer code.

---

## Implementation Units

### U1. Create `Llm::Chat` non-streaming wrapper

**Goal:** Provide a simple `chat(messages)` interface that subsystems can use to call the LLM without managing streaming callbacks.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Create: `lib/llm/chat.rb`
- Modify: `lib/llm/provider.rb` (add `complete` instance method)
- Test: `test/lib/llm/chat_test.rb`

**Approach:**
- Add a `complete(messages)` method to `Llm::Provider` base class that calls `stream(messages)` with a no-op block that collects tokens and returns the full text. This avoids duplicating the API call logic.
- Create `Llm::Chat` as a higher-level wrapper with:
  - `Llm::Chat.new(model: "gpt-4.1-nano")` — defaults from `flyd.yml` `extraction_model`, falls back to `default_model`
  - `#call(messages)` — returns response text, raises `Llm::Chat::Error` on failure
  - `#call!(messages)` — same but raises on empty response or parse failure
- Use `Flyd::KeyLoader.default_model` as fallback when extraction_model is not configured.

**Test scenarios:**
- Happy path: `Llm::Chat#call` with valid messages returns non-empty string
- Error path: `Llm::Chat#call` with invalid API key raises `Llm::Chat::Error`
- Happy path: `Llm::Provider#complete` delegates to `stream` and returns full text

**Verification:**
- `bin/rails runner 'puts Llm::Chat.new.call([{role:"user", content:"Say hello in one word"}])'` prints a response

---

### U2. Wire MemoryEngine decision extraction to real LLM

**Goal:** Replace the `call_llm` stub with a real `Llm::Chat` call so decisions are actually extracted from conversations.

**Requirements:** R1

**Dependencies:** U1

**Files:**
- Modify: `lib/subsystems/memory_engine.rb`
- Test: `test/lib/subsystems/memory_engine_test.rb`

**Approach:**
- Replace `def call_llm(prompt)` body with a `Llm::Chat` call
- The existing `extract_decisions` method already parses the JSON response and creates Decision records — no change needed there
- Update the test at `memory_engine_test.rb:16` — currently asserts `assert_equal 0, @project.decisions.count`

**Test scenarios:**
- Happy path: extracting decisions from a conversation with 3 messages produces Decision records with `extracted_at` set
- Edge case: extracting from a conversation with only 1 short message produces no decisions (not enough context)
- Integration: context injection includes newly extracted decisions
- Error path: LLM returns invalid JSON — `parse_decisions` returns `[]`, no crash

**Verification:**
- Running the test suite — `bin/rails test test/lib/subsystems/memory_engine_test.rb`

---

### U3. Wire BeliefEngine contradiction detection and topic extraction

**Goal:** Replace two stubs — `potentially_contradicts?` and `extract_topic` — with real LLM calls.

**Requirements:** R2, R3

**Dependencies:** U1

**Files:**
- Modify: `lib/subsystems/belief_engine.rb`
- Test: `test/lib/subsystems/belief_engine_test.rb`

**Approach:**
- Replace `extract_topic(content)` with an LLM call asking "What topic does this decision relate to? Answer in 1-3 words."
  - Strip whitespace, downcase the result
  - Handle empty/error responses by falling back to first-3-words
- Replace `potentially_contradicts?(belief_statement, decision_content)` with an LLM call asking "Does the following decision contradict the existing belief? Answer ONLY 'yes' or 'no'."
  - Return `true` if response matches `/y/i`
  - On error or non-matching response, return `false` (conservative)

**Test scenarios:**
- Happy path: `extract_topic` with a decision about PostgreSQL returns e.g. `"database choice"` via LLM stub
- Error path: `extract_topic` with empty string returns fallback
- Happy path: `potentially_contradicts?` returns true when belief says "use MySQL" and decision says "use PostgreSQL"
- Edge case: `potentially_contradicts?` with unrelated belief returns false
- Error path: `potentially_contradicts?` on LLM timeout returns false

**Verification:**
- `bin/rails test test/lib/subsystems/belief_engine_test.rb`

---

### U4. Wire BehaviourEngine trigger extraction

**Goal:** Replace the `extract_trigger` stub with a real LLM call.

**Requirements:** R4

**Dependencies:** U1

**Files:**
- Modify: `lib/subsystems/behaviour_engine.rb`
- Create: `test/lib/subsystems/behaviour_engine_test.rb`

**Approach:**
- Replace `extract_trigger(sequence)` with an LLM call:
  - Build a prompt from the sequence of decisions: "Given these decisions, what trigger phrase describes this pattern? 2-5 words, return ONLY the phrase."
  - On empty/error, return `nil` (don't create behaviours from failed extractions)
- The rest of `compile_from_patterns` stays the same

**Test scenarios:**
- Happy path: `extract_trigger` with database setup decisions returns e.g. "database configuration decision"
- Edge case: `extract_trigger` with empty sequence returns nil
- Error path: `extract_trigger` on LLM failure returns nil
- Happy path: `compile_from_patterns` creates behaviours with non-nil triggers
- Happy path: existing matching behaviour gets reinforced

**Verification:**
- `bin/rails test test/lib/subsystems/behaviour_engine_test.rb`

---

### U5. Inject project context into chat system prompt

**Goal:** The LLM should see relevant decisions, beliefs, and matching behaviours when responding.

**Requirements:** R5

**Dependencies:** U2

**Files:**
- Modify: `app/jobs/llm_streaming_job.rb`
- Test: `test/jobs/llm_streaming_job_test.rb` (create)

**Approach:**
- In `LlmStreamingJob#system_prompt`, after the base prompt, append the output of `MemoryEngine#inject_context_into_prompt`
- Also include matched behaviour steps if the user message matches a known trigger

**Test scenarios:**
- Happy path: system prompt includes recent decisions when they exist
- Edge case: system prompt is unchanged when no decisions or beliefs exist
- Happy path: matching behaviour steps are included when the message matches a trigger

**Verification:**
- `bin/rails test test/jobs/llm_streaming_job_test.rb`

---

### U6. Wire OpencodeBuildJob to real shell execution

**Goal:** Replace the hardcoded mock build result with an actual subprocess call to `opencode run`.

**Requirements:** R6

**Dependencies:** U5

**Files:**
- Modify: `app/jobs/opencode_build_job.rb`
- Test: `test/jobs/opencode_build_job_test.rb` (create)

**Approach:**
- Replace `execute_opencode(input, context, root_path)` with `Open3.capture3`
- Write context to tempfile
- Parse JSON from stdout
- Handle errors gracefully

**Test scenarios:**
- Happy path: successful shell execution returns parsed JSON
- Error path: `opencode` not found returns failure result
- Error path: non-zero exit returns failure result
- Edge case: `root_path` is nil — runs in `Dir.home`

**Verification:**
- `bin/rails test test/jobs/opencode_build_job_test.rb`

---

### U7. Configure sidekiq-cron schedule

**Goal:** Set up recurring schedules for learning loop jobs.

**Requirements:** R7

**Dependencies:** None

**Files:**
- Create: `config/sidekiq.yml`
- Create: `config/initializers/sidekiq_cron.rb`

**Approach:**
- Create `config/sidekiq.yml` with `:scheduler:` section for three jobs
- Create initializer that reads the YAML and registers cron jobs

**Test scenarios:**
- Integration: loading the initializer registers the three cron jobs
- Happy path: schedule YAML parses correctly

**Verification:**
- `bin/rails runner 'puts Sidekiq::Cron::Job.all.map(&:name)'` shows all three names

---

### U8. Add missing test coverage

**Goal:** Fill testing gaps for the full learning loop.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** U2, U3, U4, U5, U6

**Files:**
- Create: `test/jobs/decision_extraction_job_test.rb`
- Create: `test/jobs/belief_synthesis_job_test.rb`
- Create: `test/controllers/messages_controller_test.rb`
- Create: `test/models/decision_test.rb`
- Create: `test/models/belief_test.rb`
- Create: `test/models/behaviour_test.rb`
- Create: `test/models/memory_edge_test.rb`
- Create: `test/models/concerns/decayable_test.rb`
- Update: Existing stub model test files

**Verification:**
- `bin/rails test` — total count increases from 69 to 85+

---

## System-Wide Impact

- **Interaction graph:** U5 changes the system prompt on every chat message. U2-U4 add mutations triggered by existing jobs.
- **Error propagation:** All LLM calls are wrapped in rescue blocks. Failures degrade gracefully.
- **State lifecycle risks:** Extraction creates decisions which immediately become visible in context. Decisions + beliefs are created atomically. The delay between extraction and injection is at most 1 message.
- **Unchanged invariants:** LlmStreamingJob still streams via ActionCable. Chat UI is unchanged. Routes are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM API failure during extraction causes silent data loss | All calls rescued; existing behavior is zero decisions — no regression |
| Extraction model costs add up | gpt-4.1-nano at ~$0.10/M tokens. ~$0.001/day for heavy use |
| opencode binary not found | Failure returned to Build model with clear message |
| sidekiq-cron jobs pile up if Sidekiq down | Cron entries load at Sidekiq startup only |

---

## Documentation / Operational Notes

- Extraction model configurable via `FLYD_EXTRACTION_MODEL` env var or `extraction_model:` in `flyd.yml`
- Verify cron: `bundle exec rails runner 'puts Sidekiq::Cron::Job.all.map(&:name)'`
- Manual learning loop test: send 5+ messages, check `Decision.count`, then verify context injection

---

## Sources & References

- Existing plan: `docs/plans/2026-07-07-001-feat-flyd-v1-plan.md`
- Existing code: `lib/subsystems/memory_engine.rb`, `lib/subsystems/belief_engine.rb`, `lib/subsystems/behaviour_engine.rb`, `app/jobs/llm_streaming_job.rb`, `app/jobs/opencode_build_job.rb`
- Test patterns: `test/lib/subsystems/memory_engine_test.rb`, `test/lib/subsystems/belief_engine_test.rb`
