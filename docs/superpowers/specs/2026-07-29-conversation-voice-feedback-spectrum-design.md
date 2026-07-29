# Conversation Voice Feedback and Spectrum Design

## Goal

Make Flyd voice interaction respond quickly with one contextual voice, keep ordinary voice conversational, move literal dictation to an explicit shortcut, preserve short follow-up context, and replace the sparse pseudo-wave input display with a real dense FFT spectrum.

## Interaction contract

- Hold `⌃fn` to speak to Flyd conversationally.
- Hold `⇧⌃fn` to dictate literal text into the focused editable field.
- Releasing `⌃fn` immediately shows the processing state while Flyd prepares the contextual answer.
- Flyd speaks only the contextual answer, using the same configured voice for every turn. It never inserts a canned processing utterance.
- A new invocation or Escape stops stale answer audio.
- Conversation input never falls through to literal insertion merely because it is phrased as a statement.
- Dictation bypasses the model and only targets `AXTextArea`, `AXTextField`, or `AXSearchField`. When there is no editable target, Flyd reports a clear error and performs no action.

## Conversation continuity

Flyd Core keeps at most 10 completed conversational exchanges in memory only. Each manifest may carry a conversation identifier. A conversation expires after 10 minutes of inactivity. Dictation never enters conversation history. No conversation data is written to disk by this feature.

The model prompt receives the recent user and assistant turns for the active conversation. Completed answer text is recorded only after a resolution is produced. Native operation payloads are not treated as conversational assistant answers.

## Immediate feedback

The panel switches to its processing state as soon as capture ends. Audio begins with the actual contextual answer; processing phrases such as “On it” are never synthesized. All conversational speech is rendered by the configured answer TTS path so a turn cannot alternate between a local system voice and the answer voice.

## Spectrum

The capture layer produces 48 logarithmically spaced FFT bands spanning approximately 80 Hz to 8 kHz. Magnitudes are converted to a decibel-like normalized range with fast attack and smooth decay.

The panel renders one thin bar per band, ordered low-to-high frequency from left to right. Bars use a quiet minimum height but no synthetic sine fallback and no uniform whole-signal level added to every frequency bin. The display therefore reflects actual spectral variation rather than a waveform envelope.

## Error handling and cancellation

- Empty or failed transcription displays the existing actionable voice error.
- A new turn stops previous answer audio and supersedes stale callbacks through the existing invocation/session checks.
- Dictation without an editable target displays “Dictation needs an editable text field.”
- Escape stops capture, relay work, answer audio, and any pending invocation work.

## Verification

- Shortcut unit tests prove `⌃fn` and `⇧⌃fn` are exclusive press/release routes.
- Source and playback tests prove there is no separate processing speaker and answer speech uses one configured TTS path.
- Routing tests prove conversation statements on non-editable elements produce answer panels and dictation is only allowed for editable roles.
- Spectrum tests prove 48 bands, bounded normalized values, low-to-high frequency discrimination, and no sine fallback.
- Core tests prove bounded conversation history, timeout, and prompt injection.
- Run the full Swift and Core suites, build both components, install with `make run`, then verify `/health`, `/voice/status`, installed logs, and a real user shortcut test.
