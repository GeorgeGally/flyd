---
title: "Voice Answers via Server-Side TTS for Flyd Overlay"
date: 2026-07-28
category: architecture-patterns
module: overlay
problem_type: architecture_pattern
component: tooling
severity: low
related_components:
  - assistant
tags:
  - tts
  - voice-responses
  - speech-synthesis
  - gpt-4o-mini-tts
  - aac-playback
---

# Voice Answers via Server-Side TTS for Flyd Overlay

## Context

When users invoked Flyd via voice (hold `fn+⌃`, speak, release), their transcribed intent was resolved and answered visually in the AugmentPanel — but no audio was spoken. The voice modality felt incomplete: the user spoke, Flyd answered in text, but the audio channel was left silent. For voice-invoked questions ("who am I?", "what's my schedule?"), this was particularly jarring — the user expects a conversational response, not a silent text panel.

The only existing audio output path was `LiveAudioBridge.playAudioOutput()`, exclusively used during the hidden LIVE mode (triple-press `⌃`), which streamed audio from OpenAI's Realtime API. One-shot invocations (the primary voice interaction path) had no TTS.

## Guidance

**Architecture decision: server-side TTS over client-side.** OpenAI's TTS API requires an API key. Routing the key through Core (where it's already configured for `FLYD_MODEL_API_KEY` or `OPENAI_API_KEY`) avoids duplicating key management in the Swift adapter and keeps the adapter thin — it receives ready-to-play AAC data and hands it to `AVAudioPlayer`. The adapter never holds API keys or knows about speech synthesis; it just plays bytes.

### Server-side: `/tts` endpoint (server.ts + tts.ts)

A new POST route on Core (`:4815/tts`) accepts `{"text": "..."}`, calls `synthesizeSpeech()` which sends it to OpenAI's `/v1/audio/speech` with `gpt-4o-mini-tts` and voice `alloy` (both configurable via `FLYD_TTS_MODEL` and `FLYD_TTS_VOICE`), and returns the raw AAC audio bytes. Uses `OPENAI_API_KEY` preferentially so `FLYD_MODEL_API_KEY` can point at a non-OpenAI provider without breaking speech.

### Client-side: SpeechPlayer (SpeechPlayer.swift)

A shared singleton wrapping `AVAudioPlayer`. `play(_ data: Data)` creates a player from raw audio data and plays it. An `AVAudioPlayerDelegate` callback nulls the player reference on completion, guarded by an identity check (`player === self.player`) to prevent a stale completion from the previous `play()` call from clearing the reference to the newer, still-playing instance.

### Config gate: ReplyMode (OverlayConfig.swift)

`ReplyMode` is an enum with cases `.text` (default) and `.voice`, persisted to `~/.flyd/overlay/config.json`. The decoder uses `decodeIfPresent` for forward-compatibility — existing config files without `replyMode` are not reset. The adapter checks `ConfigManager.shared.config.replyMode` at invocation time.

### Integration: wired in processInvocation (main.swift)

Two blocks — one for `native` mode, one for `requires_augment` mode — each guarded by `modality == "voice" && ConfigManager.shared.config.replyMode == .voice`. For native, joins successful operation texts with ". "; for augment, filters to `explanation`-kind augmentations and joins their content. Non-empty text is sent to `flydClient.speak(text:)` which returns `Data?`, and the audio is played on the main actor via `SpeechPlayer.shared.play(audio)`.

### LIVE mode removed

The hidden LIVE mode (triple-press `⌃` with bidirectional Realtime API audio) was dismantled in the same session. Hold-to-talk with server-side TTS gives the same outcome — voice answers — without maintaining two parallel voice backends. `LiveAudioBridge.swift` was deleted; `FlydMode.live` was removed from the state machine.

## Why This Matters

Voice invocations that speak back feel natural and complete — the user speaks, Flyd understands and acts, and the response is delivered through the same channel. Without TTS, voice-invoked answers are silent, which feels broken: the user sees text appear but hears nothing, breaking the illusion of conversation. Closing the audio loop is the difference between a voice feature and a voice product.

Server-side TTS (OpenAI) was chosen over client-side macOS `NSSpeechSynthesizer` because it offers higher-quality neural voices, model selection flexibility, and reuses the existing Core API key infrastructure — at the cost of requiring internet and API key access.

## When to Apply

- Modality is `"voice"` (from voice transcription, not text input)
- `ReplyMode` is `.voice` in user config
- The augmentation or native result text is non-empty
- `OPENAI_API_KEY` or `FLYD_MODEL_API_KEY` is set on the server

## Examples

### Full invocation flow

1. User voice-invokes (hold `fn+⌃`, speak, release)
2. Audio captured → WS relay (`:4816`) → OpenAI transcription → text
3. Core `/manifest` resolves → `requires_augment` mode with explanation augmentations
4. AugmentPanel shows answer text visually
5. `processInvocation` checks `modality == "voice" && replyMode == .voice`
6. `flydClient.speak(text:)` POSTs to Core `/tts`
7. Core `handleTts` → `synthesizeSpeech()` → OpenAI `/v1/audio/speech` → AAC bytes returned
8. `SpeechPlayer.shared.play(audio)` plays answer through Mac speakers

### Speech synthesis (cli/src/tts.ts)

```typescript
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;
  const trimmed = text.trim().slice(0, 4000);
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.FLYD_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.FLYD_TTS_VOICE || "alloy",
      input: trimmed,
      response_format: "aac",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return Buffer.from(await response.arrayBuffer());
}
```

### Speech playback (SpeechPlayer.swift)

```swift
final class SpeechPlayer: NSObject {
    static let shared = SpeechPlayer()
    private var player: AVAudioPlayer?

    func play(_ data: Data) {
        guard let player = try? AVAudioPlayer(data: data) else { return }
        self.player?.stop()
        self.player = player
        player.delegate = self
        player.play()
    }

    func stop() {
        player?.stop()
        player = nil
    }
}

extension SpeechPlayer: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === self.player else { return }
        self.player = nil
    }
}
```

### Voice reply wiring (main.swift)

```swift
if modality == "voice", ConfigManager.shared.config.replyMode == .voice {
    let spokenText = (resolution.augmentations ?? [])
        .filter { $0.kind == "explanation" }
        .map(\.content)
        .joined(separator: ". ")
    if !spokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        if let audio = await flydClient.speak(text: spokenText) {
            await MainActor.run {
                SpeechPlayer.shared.play(audio)
            }
        }
    }
}
```

### Client HTTP call (FlydClient.swift)

```swift
func speak(text: String) async -> Data? {
    guard let url = URL(string: "\(baseURL)/tts") else { return nil }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
    request.timeoutInterval = 30
    request.httpBody = try? JSONEncoder().encode(["text": text])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
    return data
}
```

## Related

- [Overlay Architecture: Thin Adapter + TypeScript Core](flyd-overlay-thin-adapter-typescript-core-2026-07-23.md) — architectural context for the Core/adapter boundary that TTS operates across
