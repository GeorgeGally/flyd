# Flyd typing suggestions

The Mac conversation window (WKWebView) displays a faint continuation of the
message George is typing. Tab accepts, Escape dismisses, and Enter retains its
normal send behavior. Accepting never sends, invokes tools, or dispatches to
Firstmate. The small ↹ button remembers on/off locally.

Only Flyd's own composer is covered. This does not intercept typing in other
apps, rewrite dictation, or automatically draft complete follow-up messages.

## Fast path and bounds

- A 220 ms typing pause requests a short suffix. Changes abort the transport;
  revision, session, focus and caret checks reject late responses even if an
  upstream ignores cancellation. Matching typed characters consume the cached
  suggestion without another request.
- A local cache reuses exact prefixes of wording George has submitted at least
  twice. It survives restart in `FLYD_DIR/view/composer/phrases.json`, bounded
  to 500 entries. Unsent drafts are not saved. Submitted wording is a completion
  hint, never a fact, memory claim, permission or reviewed routing label.
- The model sees the draft plus at most six recent human conversation messages,
  each capped at 400 characters. No retrieval, profile, clipboard, screens,
  attachments, relayed updates or backstage wake messages. Obvious credential
  drafts are excluded and credential-containing context messages omitted.
- Provider calls have a 1.2 second deadline, 96 output-token ceiling, 12-word /
  160-character visible ceiling, no tools, no retries and no paid fallback.
  Global request spacing is at least 650 ms, at most two active calls and 600
  requests per process-hour. Provider errors cool down for 30 seconds.
- Slash commands, selected text, mid-draft cursors, IME composition, attachments,
  recording and transcription suppress suggestions. No suggestion is a normal
  result. Prediction failure cannot block sending.

## Model and setup

`FLYD_PREDICTION_MODEL` selects an exact OpenAI-compatible model through Flyd's
existing provider-qualified connections. Default:

```dotenv
OPENROUTER_API_KEY=...
FLYD_PREDICTION_MODEL=openrouter:inception/mercury-2.5
```

No Meta model is selected. OpenRouter requests disable reasoning, choose
latency-oriented provider routing, disable provider fallback and exclude
providers that collect data. Unavailable credentials/provider support means
local matches only. Nothing falls back to the general chat model.

Set `FLYD_PREDICTIONS=0` to disable prediction requests and phrase collection.
The UI toggle suppresses requests from that composer; submitted wording may
still enter the local phrase cache while the server-wide feature is enabled.
To remove its retained wording, stop the view and delete the composer folder.
Private cache and metrics files use mode 0600 in a mode 0700 directory.

Model choice is provisional. On 10 October 2026, OpenRouter listed Mercury 2.5
at a promotional $0.04/M input and $0.15/M output, with 80% off displayed.
Its published aggregate latency was 0.93 s, versus the earlier Groq/Llama
comparison's 0.11 s: do not equate diffusion throughput with faster short
completions. At 500 input and 20 output tokens, 30,000 calls calculate to $0.69
in inference at those promotional rates, before platform fees. This is an
illustration, not a billing guarantee or measured Flyd workload.

Sources checked:
- https://openrouter.ai/inception/mercury-2.5/
- https://openrouter.ai/meta-llama/llama-3.1-8b-instruct
- https://openrouter.ai/google/gemini-2.5-flash-lite
- https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

## Measure before changing models

Authenticated local `GET /api/prediction-status?token=<view-token>` returns
per-model request, shown, accepted, dismissed, edited-after-acceptance,
timeout/error/cancel counts, accepted characters, usage and successful-offer
p50/p95 latency. Metrics contain no draft or suggestion text; billing remains
unknown when the provider does not report it. Local matches are a separate arm.
These are performance/interaction statistics, not evidence that an accepted
suggestion is true. No automatic model or prompt promotion is introduced.

An explicit offline benchmark can compare non-Meta candidates using a private
JSON array of `{draft, messages:[{id,role,text}], expectedSuffix?}`:

```bash
cd cli
npm run evals:composer -- /private/typing-cases.json \
  openrouter:inception/mercury-2.5 \
  openrouter:google/gemini-2.5-flash-lite
```

It prints aggregates only. Reference-prefix agreement is limited: multiple
valid continuations exist, and live acceptance/edit behavior remains necessary.
Compare deadline misses and shown-to-accepted rates, not token throughput alone.
No real-model quality/speed superiority is claimed by synthetic tests.

`npm run test:composer-predictions` covers the bounded service and actual
transport with injected providers (Node 24 recommended). Happy DOM tests run
the client and existing real page; server tests cover authentication, bounded
context and zero dispatch. CI also typechecks, builds and tests active Core.

The installed Mac view must be restarted on updated source (and the supported
Mac build/install path used when needed). This cloud workspace cannot install
onto George's Mac or measure his provider latency.
