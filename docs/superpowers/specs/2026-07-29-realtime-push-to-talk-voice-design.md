# Realtime Push-to-Talk Voice Design

## Goal

Make `⌃fn` feel like a natural spoken conversation. Flyd must begin playing the
actual answer while it is being generated. It must not synthesize a canned
acknowledgement, wait for a complete text answer, or hand one turn between
different voices.

Literal dictation on `⇧⌃fn` is unchanged.

## Product contract

- Pressing `⌃fn` starts microphone capture immediately.
- Releasing `⌃fn` commits the captured turn to the Realtime session.
- The first Realtime audio delta starts playback immediately.
- Later audio deltas are scheduled continuously in arrival order.
- The answer panel is updated from the transcript deltas belonging to that same
  response.
- Every conversational turn uses one configured Realtime voice. The default is
  `marin`.
- Flyd never speaks a processing phrase such as “On it” or “I’m working on it.”
- Flyd never invokes the separate text-to-speech endpoint for a Realtime
  push-to-talk answer.
- Starting a new turn cancels any response that is still playing and prevents
  stale audio or transcript deltas from the previous response from appearing.

## Architecture

The existing Realtime WebSocket and 24 kHz PCM playback path become the
conversation implementation for `⌃fn`. The existing transcription-to-manifest
path remains available to `⇧⌃fn` dictation and non-Realtime text invocation, but
it no longer owns conversational answer speech.

The macOS adapter owns a push-to-talk controller with four responsibilities:

1. Keep a Realtime connection warm without activating the microphone.
2. Start capture immediately and buffer PCM while the connection is not ready.
3. Flush buffered PCM in order, then commit the turn on shortcut release.
4. Play only audio deltas associated with the current response identifier.

Flyd Core owns the OpenAI Realtime session. Push-to-talk sessions disable
server VAD so shortcut release, rather than silence detection, ends the turn.
On commit, Core sends `input_audio_buffer.commit` followed by
`response.create`. Core forwards audio and transcript deltas with stable
session and response identifiers.

The existing LIVE mode remains separate. It continues to use server VAD and the
triple-Control toggle. A push-to-talk invocation first stops LIVE mode, as it
does today, so the two audio owners cannot overlap.

## Connection lifecycle

Flyd opens the push-to-talk Realtime connection after normal app startup and
keeps it ready between turns. Opening the socket does not start microphone
capture.

If the user presses `⌃fn` before the socket is ready, capture still starts and
PCM is buffered locally. Once Core reports `ready`, the adapter flushes the
buffer before sending new live chunks.

If shortcut release occurs while the connection is still becoming ready, the
adapter records a pending commit. It sends the commit only after every buffered
chunk has been flushed. This prevents the beginning of speech from being
dropped or the commit from overtaking audio.

The bridge reconnects after transport failure or Realtime session expiry. A
turn that fails before any response audio is played ends with a visible,
actionable error. It does not fall back automatically to the old full-answer
TTS path because that would silently restore the latency and voice behavior
this design removes.

## Realtime session behavior

Push-to-talk sessions use:

- audio input and audio-plus-transcript output;
- 24 kHz PCM input and output;
- `marin` as the default output voice;
- no automatic turn detection;
- direct, conversational response instructions;
- the existing `flyd_resolve_intent` tool when the question requires personal
  memory, visible application context, or a computer action.

Ordinary conversational questions can begin audio generation directly. Tool
dependent questions may take longer because Flyd must retrieve or inspect
context first, but their eventual answer still arrives as one streamed
Realtime voice. A tool result never triggers the separate `/tts` endpoint.

The Realtime conversation supplies short-term follow-up continuity. Flyd
retains the existing product boundary of at most ten completed exchanges and a
ten-minute idle expiry. Core records completed user and assistant transcripts;
when it creates a replacement Realtime session, it seeds only that bounded
history. Incomplete or cancelled responses are not added to history.

## Adapter state and presentation

The visible state sequence is:

1. `listening` while `⌃fn` is held;
2. `responding` after release and before or during streamed output;
3. `present` when the response completes.

There is no synthetic spoken processing state. The panel itself supplies
immediate visual acknowledgement.

Transcript deltas are accumulated into one answer card for the active
invocation. The card is updated in place rather than adding a card for every
delta. On `response.done`, the final accumulated transcript is retained in the
panel and recorded in conversation history.

## Cancellation and single-voice guarantees

Each connection, turn, and response has an identifier. The adapter accepts
audio and transcript deltas only when all identifiers match the active
invocation.

Pressing `⌃fn` during playback:

- sends `response.cancel` for the active response;
- stops and clears queued PCM;
- invalidates callbacks from the old response;
- starts the new capture immediately.

`Escape`, application shutdown, and bridge failure perform the same audio
cleanup. `SpeechPlayer` and `/tts` are not called for Realtime conversational
turns. These constraints ensure one playback owner, one answer, and one voice.

## Diagnostics and success criteria

Core and the adapter record:

- socket-ready latency;
- shortcut-release timestamp;
- first audio-delta timestamp;
- first audible playback timestamp;
- response completion timestamp;
- cancellation and reconnect reasons.

The primary latency metric is time from shortcut release to first audible
playback, not time to the final transcript. A warm-session local smoke should
begin playback within 1.5 seconds under normal network conditions. The metric
is logged rather than enforced as a unit-test timeout because network latency
is variable.

Success requires a real installed-app test demonstrating:

- the first audible content is part of the actual answer;
- audio starts before the complete answer exists;
- the voice remains the same for the whole response and subsequent turns;
- interrupting a response prevents old audio from resuming;
- the final transcript remains visible and is not cut off.

## Testing

Core tests cover:

- push-to-talk session configuration uses no VAD and one voice;
- `commit` emits `input_audio_buffer.commit` before `response.create`;
- audio and transcript deltas include the active response identifier;
- tool output resumes the same Realtime response path;
- cancelled and incomplete responses do not enter history;
- completed history is bounded to ten exchanges and expires after ten minutes.

macOS tests cover:

- early PCM is buffered until `ready`;
- buffered PCM is flushed in order before a pending commit;
- a current response accepts audio and transcript deltas;
- a stale response is ignored;
- cancellation clears scheduled PCM;
- Realtime conversation never requests `/tts`;
- `⇧⌃fn` dictation continues to use its existing isolated path.

Verification runs the full Core and Swift suites, builds the release adapter,
installs it with `cd mac-adapter && make run`, checks installed health and
Realtime readiness, then performs a real two-turn shortcut test including an
interruption.

## Non-goals

- No provider or voice picker is added.
- No changes are made to `⇧⌃fn` dictation.
- No canned or model-generated acknowledgement is added before the answer.
- No sentence-by-sentence text-to-speech queue is introduced.
- No automatic fallback may create overlapping audio or switch voices.
