# Realtime Push-to-Talk Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `⌃fn` conversation's full-text-then-TTS path with one natural OpenAI Realtime voice that begins playing while its response is still being generated.

**Architecture:** Flyd Core extends its existing Realtime WebSocket with an explicit push-to-talk mode, manual commit/cancel events, response identifiers, transcript forwarding, and bounded history. The macOS adapter adds a tested turn gate that buffers early PCM, commits only after flushing it, filters stale response events, and drives the existing streaming PCM player and a single live answer card. `⇧⌃fn` dictation and triple-Control LIVE mode keep their existing routing.

**Tech Stack:** TypeScript, Vitest, Node `ws`, OpenAI Realtime WebSocket API, Swift 5.9, AppKit, AVFoundation/24 kHz PCM, XCTest.

---

## Checkout safety

The main checkout currently contains unrelated user changes under:

- `cli/src/lib/brain-retrieval.ts`
- `cli/src/lib/librarian.ts`
- `cli/src/lib/retrieval.ts`
- `cli/src/resolve.ts`
- their currentness/recall/retrieval tests and new helper files

Do not stage, rewrite, format, or commit those files. Every commit below must
name its files explicitly.

### Task 1: Define the Core push-to-talk protocol

**Files:**
- Create: `cli/src/realtime-protocol.ts`
- Create: `cli/src/__tests__/realtime-protocol.test.ts`

- [ ] **Step 1: Write the failing protocol tests**

```ts
import { describe, expect, it } from "vitest";
import {
  REALTIME_INSTRUCTIONS,
  buildRealtimeSessionConfig,
  pushToTalkCommitEvents,
  adaptRealtimeServerEvent,
} from "../realtime-protocol.js";

describe("push-to-talk Realtime protocol", () => {
  it("uses one natural voice and manual turn detection", () => {
    const session = buildRealtimeSessionConfig("push_to_talk", "marin");
    expect(session.audio.output.voice).toBe("marin");
    expect(session.turn_detection).toBeNull();
    expect(REALTIME_INSTRUCTIONS).toContain("brief, varied conversational lead-in");
    expect(REALTIME_INSTRUCTIONS).toContain("Never repeat a stock acknowledgement");
  });

  it("keeps LIVE on server VAD", () => {
    const session = buildRealtimeSessionConfig("live", "marin");
    expect(session.turn_detection).toMatchObject({ type: "server_vad" });
  });

  it("commits audio before requesting a response", () => {
    expect(pushToTalkCommitEvents()).toEqual([
      { type: "input_audio_buffer.commit" },
      { type: "response.create" },
    ]);
  });

  it("adds turn and response identity to streamed output", () => {
    expect(adaptRealtimeServerEvent(
      { type: "response.audio.delta", response_id: "response-1", delta: "AA==" },
      "turn-1",
    )).toEqual({
      type: "audio_output",
      turn_id: "turn-1",
      response_id: "response-1",
      audio: "AA==",
    });
  });
});
```

- [ ] **Step 2: Run the protocol test and verify RED**

Run:

```bash
npm test --prefix cli -- --run src/__tests__/realtime-protocol.test.ts
```

Expected: FAIL because `realtime-protocol.ts` does not exist.

- [ ] **Step 3: Implement the pure protocol**

Create `cli/src/realtime-protocol.ts` with:

```ts
export type RealtimeSessionMode = "live" | "push_to_talk";

export const REALTIME_INSTRUCTIONS =
  "You are Flyd, a natural voice assistant overlaying the user's Mac. " +
  "Respond as one present conversational partner. You may begin a difficult " +
  "or tool-dependent turn with a brief, varied conversational lead-in when it " +
  "fits, then continue naturally into the answer. Never repeat a stock " +
  "acknowledgement and never announce status mechanically. Answer simple " +
  "questions directly. Use flyd_resolve_intent for personal memory, visible " +
  "application context, or computer actions. Speak tool results in the same " +
  "voice response.";

const tools = [{
  type: "function",
  name: "flyd_resolve_intent",
  description: "Resolve personal context, visible Mac context, or an action.",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string" },
      environment_revision: { type: "number" },
    },
    required: ["intent", "environment_revision"],
  },
}];

export function buildRealtimeSessionConfig(
  mode: RealtimeSessionMode,
  voice = process.env.FLYD_REALTIME_VOICE || "marin",
) {
  return {
    type: "realtime",
    modalities: ["text", "audio"],
    instructions: REALTIME_INSTRUCTIONS,
    turn_detection: mode === "live" ? { type: "server_vad" } : null,
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        transcription: { model: "gpt-realtime-whisper" },
      },
      output: {
        format: { type: "audio/pcm", rate: 24000 },
        voice,
      },
    },
    tools,
    tool_choice: "auto",
  };
}

export function pushToTalkCommitEvents() {
  return [
    { type: "input_audio_buffer.commit" },
    { type: "response.create" },
  ];
}

export function adaptRealtimeServerEvent(
  event: Record<string, unknown>,
  turnId: string,
): Record<string, unknown> | null {
  if (event.type === "response.audio.delta") {
    return {
      type: "audio_output",
      turn_id: turnId,
      response_id: event.response_id,
      audio: event.delta,
    };
  }
  if (event.type === "response.audio_transcript.delta") {
    return {
      type: "transcript_delta",
      turn_id: turnId,
      response_id: event.response_id,
      text: event.delta,
    };
  }
  if (event.type === "response.done") {
    const response = event.response as Record<string, unknown> | undefined;
    return {
      type: "response_done",
      turn_id: turnId,
      response_id: response?.id,
      status: response?.status,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run the protocol test and verify GREEN**

Run the focused command from Step 2.

Expected: 1 file and 4 tests pass.

- [ ] **Step 5: Commit the protocol**

```bash
git add cli/src/realtime-protocol.ts cli/src/__tests__/realtime-protocol.test.ts
git commit -m "feat(voice): define realtime push-to-talk protocol"
```

### Task 2: Wire push-to-talk control messages into Flyd Core

**Files:**
- Modify: `cli/src/realtime-session.ts:1-205`
- Modify: `cli/src/__tests__/realtime-session.test.ts`

- [ ] **Step 1: Add failing session-control tests**

Add imports and tests:

```ts
import {
  buildAdapterControlEvents,
  buildResolveToolOutput,
} from "../realtime-session.js";

describe("buildAdapterControlEvents", () => {
  it("maps a push-to-talk commit to OpenAI commit then response creation", () => {
    expect(buildAdapterControlEvents(
      { type: "commit", turn_id: "turn-1" },
      "push_to_talk",
    )).toEqual([
      { type: "input_audio_buffer.commit" },
      { type: "response.create" },
    ]);
  });

  it("maps cancellation without starting another response", () => {
    expect(buildAdapterControlEvents(
      { type: "cancel", turn_id: "turn-1" },
      "push_to_talk",
    )).toEqual([{ type: "response.cancel" }]);
  });

  it("ignores commit in LIVE mode", () => {
    expect(buildAdapterControlEvents(
      { type: "commit", turn_id: "turn-1" },
      "live",
    )).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the session test and verify RED**

```bash
npm test --prefix cli -- --run src/__tests__/realtime-session.test.ts
```

Expected: FAIL because `buildAdapterControlEvents` is missing.

- [ ] **Step 3: Implement control routing and event identity**

In `cli/src/realtime-session.ts`:

```ts
import {
  adaptRealtimeServerEvent,
  buildRealtimeSessionConfig,
  pushToTalkCommitEvents,
  type RealtimeSessionMode,
} from "./realtime-protocol.js";

export function buildAdapterControlEvents(
  message: { type?: string; turn_id?: string },
  mode: RealtimeSessionMode,
): Array<Record<string, unknown>> {
  if (mode !== "push_to_talk") return [];
  if (message.type === "commit") return pushToTalkCommitEvents();
  if (message.type === "cancel") return [{ type: "response.cancel" }];
  return [];
}
```

Track `mode`, `conversationId`, and `activeTurnId` per adapter connection. Parse:

```ts
case "start":
  mode = msg.mode === "push_to_talk" ? "push_to_talk" : "live";
  conversationId = typeof msg.conversation_id === "string"
    ? msg.conversation_id
    : sessionId;
  openaiWs = await connectRealtime(
    adapterWs,
    observationResolvers,
    mode,
    () => activeTurnId,
  );
  break;
case "audio":
  activeTurnId = typeof msg.turn_id === "string" ? msg.turn_id : activeTurnId;
  // Existing input_audio_buffer.append send remains here.
  break;
case "commit":
case "cancel":
  activeTurnId = typeof msg.turn_id === "string" ? msg.turn_id : activeTurnId;
  for (const event of buildAdapterControlEvents(msg, mode)) {
    openaiWs?.send(JSON.stringify(event));
  }
  break;
```

Replace the inline session object with
`buildRealtimeSessionConfig(mode)`. For every OpenAI message, call
`adaptRealtimeServerEvent(ev, getActiveTurnId())` and forward a non-null result
to the adapter. Keep the existing tool-call handling on `response.done`.

- [ ] **Step 4: Run focused Core tests**

```bash
npm test --prefix cli -- --run src/__tests__/realtime-protocol.test.ts src/__tests__/realtime-session.test.ts
```

Expected: 2 files pass.

- [ ] **Step 5: Commit Core control routing**

```bash
git add cli/src/realtime-session.ts cli/src/__tests__/realtime-session.test.ts
git commit -m "feat(voice): route realtime push-to-talk turns"
```

### Task 3: Preserve bounded Realtime follow-up history

**Files:**
- Modify: `cli/src/conversation-history.ts`
- Modify: `cli/src/__tests__/conversation-history.test.ts`
- Modify: `cli/src/realtime-session.ts`
- Modify: `cli/src/__tests__/realtime-session.test.ts`

- [ ] **Step 1: Add failing history-seeding and completion tests**

Add:

```ts
import { realtimeHistoryItems } from "../conversation-history.js";

it("converts only completed bounded turns into Realtime items", () => {
  const store = new ConversationHistoryStore(2);
  store.append("chat", "one", "answer one", 1);
  store.append("chat", "two", "answer two", 2);
  store.append("chat", "three", "answer three", 3);

  expect(realtimeHistoryItems(store.get("chat", 4))).toEqual([
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "two" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "answer two" }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "three" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "answer three" }],
    },
  ]);
});
```

- [ ] **Step 2: Run the history test and verify RED**

```bash
npm test --prefix cli -- --run src/__tests__/conversation-history.test.ts
```

Expected: FAIL because `realtimeHistoryItems` is missing.

- [ ] **Step 3: Implement history conversion and recording**

Add to `conversation-history.ts`:

```ts
export function realtimeHistoryItems(turns: ConversationTurn[]) {
  return turns.flatMap((turn) => [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: turn.user }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: turn.assistant }],
    },
  ]);
}
```

In `realtime-session.ts`, after `session.update`, seed
`conversationHistory.get(conversationId)` as `conversation.item.create` events.
Accumulate `conversation.item.input_audio_transcription.completed` and
`response.audio_transcript.delta` text for the active turn. Append to
`conversationHistory` only when `response.done.status === "completed"` and both
transcripts are non-empty. Clear accumulators on cancel, failure, or incomplete
responses.

- [ ] **Step 4: Run history and Realtime tests**

```bash
npm test --prefix cli -- --run src/__tests__/conversation-history.test.ts src/__tests__/realtime-session.test.ts
```

Expected: both files pass, including ten-turn and ten-minute expiry tests.

- [ ] **Step 5: Commit bounded history**

```bash
git add cli/src/conversation-history.ts cli/src/__tests__/conversation-history.test.ts cli/src/realtime-session.ts cli/src/__tests__/realtime-session.test.ts
git commit -m "feat(voice): retain bounded realtime conversation"
```

### Task 4: Add a pure adapter turn gate

**Files:**
- Create: `mac-adapter/Sources/Bridge/PushToTalkTurnGate.swift`
- Create: `mac-adapter/Tests/PushToTalkTurnGateTests.swift`

- [ ] **Step 1: Write failing turn-gate tests**

```swift
import Foundation
import XCTest
@testable import FlydMacAdapter

final class PushToTalkTurnGateTests: XCTestCase {
    func testBuffersAudioUntilReadyThenFlushesInOrder() {
        var gate = PushToTalkTurnGate()
        _ = gate.start(turnId: "turn-1")
        XCTAssertEqual(gate.receiveAudio(Data([1])), [])
        XCTAssertEqual(gate.receiveAudio(Data([2])), [])
        XCTAssertEqual(gate.markReady(), [
            .sendAudio(turnId: "turn-1", data: Data([1])),
            .sendAudio(turnId: "turn-1", data: Data([2])),
        ])
    }

    func testReleaseBeforeReadyCommitsAfterBufferedAudio() {
        var gate = PushToTalkTurnGate()
        _ = gate.start(turnId: "turn-1")
        _ = gate.receiveAudio(Data([1]))
        XCTAssertEqual(gate.release(), [])
        XCTAssertEqual(gate.markReady(), [
            .sendAudio(turnId: "turn-1", data: Data([1])),
            .commit(turnId: "turn-1"),
        ])
    }

    func testRejectsStaleResponseEvents() {
        var gate = PushToTalkTurnGate()
        _ = gate.start(turnId: "turn-2")
        XCTAssertFalse(gate.accepts(turnId: "turn-1"))
        XCTAssertTrue(gate.accepts(turnId: "turn-2"))
    }

    func testNewTurnCancelsOldResponse() {
        var gate = PushToTalkTurnGate()
        gate.setActiveResponse("response-1", turnId: "turn-1")
        XCTAssertEqual(gate.start(turnId: "turn-2"), [
            .cancel(turnId: "turn-1", responseId: "response-1"),
            .clearPlayback,
        ])
    }
}
```

- [ ] **Step 2: Run the Swift test and verify RED**

```bash
swift test --package-path mac-adapter --filter PushToTalkTurnGateTests
```

Expected: FAIL because `PushToTalkTurnGate` is missing.

- [ ] **Step 3: Implement the state machine**

Create:

```swift
import Foundation

enum PushToTalkEffect: Equatable {
    case sendAudio(turnId: String, data: Data)
    case commit(turnId: String)
    case cancel(turnId: String, responseId: String)
    case clearPlayback
}

struct PushToTalkTurnGate {
    private var isReady = false
    private var turnId: String?
    private var bufferedAudio: [Data] = []
    private var pendingCommit = false
    private var activeResponse: (turnId: String, responseId: String)?

    mutating func start(turnId newTurnId: String) -> [PushToTalkEffect] {
        var effects: [PushToTalkEffect] = []
        if let activeResponse {
            effects = [
                .cancel(
                    turnId: activeResponse.turnId,
                    responseId: activeResponse.responseId
                ),
                .clearPlayback,
            ]
        }
        turnId = newTurnId
        bufferedAudio = []
        pendingCommit = false
        activeResponse = nil
        return effects
    }

    mutating func receiveAudio(_ data: Data) -> [PushToTalkEffect] {
        guard let turnId else { return [] }
        guard isReady else {
            bufferedAudio.append(data)
            return []
        }
        return [.sendAudio(turnId: turnId, data: data)]
    }

    mutating func markReady() -> [PushToTalkEffect] {
        isReady = true
        guard let turnId else { return [] }
        var effects = bufferedAudio.map {
            PushToTalkEffect.sendAudio(turnId: turnId, data: $0)
        }
        bufferedAudio = []
        if pendingCommit {
            effects.append(.commit(turnId: turnId))
            pendingCommit = false
        }
        return effects
    }

    mutating func release() -> [PushToTalkEffect] {
        guard let turnId else { return [] }
        guard isReady else {
            pendingCommit = true
            return []
        }
        return [.commit(turnId: turnId)]
    }

    mutating func setActiveResponse(_ responseId: String, turnId: String) {
        guard accepts(turnId: turnId) else { return }
        activeResponse = (turnId, responseId)
    }

    func accepts(turnId candidate: String) -> Bool {
        candidate == turnId
    }
}
```

- [ ] **Step 4: Run the focused Swift test**

Run the command from Step 2.

Expected: 4 tests pass.

- [ ] **Step 5: Commit the turn gate**

```bash
git add mac-adapter/Sources/Bridge/PushToTalkTurnGate.swift mac-adapter/Tests/PushToTalkTurnGateTests.swift
git commit -m "feat(voice): gate realtime push-to-talk turns"
```

### Task 5: Extend the adapter Realtime bridge

**Files:**
- Modify: `mac-adapter/Sources/Bridge/LiveAudioBridge.swift:1-215`
- Create: `mac-adapter/Sources/Bridge/RealtimeBridgeMessage.swift`
- Create: `mac-adapter/Tests/RealtimeBridgeMessageTests.swift`

- [ ] **Step 1: Write failing message codec tests**

```swift
import XCTest
@testable import FlydMacAdapter

final class RealtimeBridgeMessageTests: XCTestCase {
    func testPushToTalkStartIncludesConversation() throws {
        let text = try RealtimeBridgeMessage.start(
            mode: .pushToTalk,
            conversationId: "chat-1"
        ).encoded()
        XCTAssertTrue(text.contains(#""mode":"push_to_talk""#))
        XCTAssertTrue(text.contains(#""conversation_id":"chat-1""#))
    }

    func testAudioAndCommitIncludeTurnIdentity() throws {
        XCTAssertTrue(
            try RealtimeBridgeMessage.audio(
                turnId: "turn-1",
                data: Data([1])
            ).encoded().contains(#""turn_id":"turn-1""#)
        )
        XCTAssertEqual(
            try RealtimeBridgeMessage.commit(turnId: "turn-1").encoded(),
            #"{"turn_id":"turn-1","type":"commit"}"#
        )
    }
}
```

- [ ] **Step 2: Run the codec test and verify RED**

```bash
swift test --package-path mac-adapter --filter RealtimeBridgeMessageTests
```

Expected: FAIL because `RealtimeBridgeMessage` is missing.

- [ ] **Step 3: Implement the codec and bridge methods**

Define `RealtimeBridgeMode` and `RealtimeBridgeMessage` as `Encodable`, with
sorted JSON keys in `encoded()` for stable tests. Extend `LiveAudioBridge` with:

```swift
var onResponseDone: ((String, String, String) -> Void)?

func connect(mode: RealtimeBridgeMode, conversationId: String) {
    // Existing connection setup, then send the encoded start message.
}

func sendAudioChunk(_ data: Data, turnId: String) {
    send(try? RealtimeBridgeMessage.audio(turnId: turnId, data: data))
}

func commit(turnId: String) {
    send(try? RealtimeBridgeMessage.commit(turnId: turnId))
}

func cancel(turnId: String, responseId: String) {
    send(try? RealtimeBridgeMessage.cancel(
        turnId: turnId,
        responseId: responseId
    ))
}
```

Parse `turn_id` and `response_id` for `audio_output`,
`transcript_delta`, and `response_done`. Change the callback signatures so
callers receive both identifiers. Keep compatibility wrappers for
`LiveSessionController` that use mode `.live`.

- [ ] **Step 4: Run bridge, LIVE, and shortcut tests**

```bash
swift test --package-path mac-adapter --filter RealtimeBridgeMessageTests
swift test --package-path mac-adapter --filter ShortcutRoutingTests
```

Expected: both focused suites pass.

- [ ] **Step 5: Commit bridge changes**

```bash
git add mac-adapter/Sources/Bridge/LiveAudioBridge.swift mac-adapter/Sources/Bridge/RealtimeBridgeMessage.swift mac-adapter/Tests/RealtimeBridgeMessageTests.swift
git commit -m "feat(voice): carry realtime turn identity"
```

### Task 6: Make streaming playback interruptible and observable

**Files:**
- Modify: `mac-adapter/Sources/Audio/StreamingAudioPlayer.swift`
- Create: `mac-adapter/Sources/Audio/StreamingPlaybackState.swift`
- Create: `mac-adapter/Tests/StreamingPlaybackStateTests.swift`

- [ ] **Step 1: Write the failing playback-state test**

```swift
import XCTest
@testable import FlydMacAdapter

final class StreamingPlaybackStateTests: XCTestCase {
    func testFirstChunkStartsPlaybackOncePerResponse() {
        var state = StreamingPlaybackState()
        XCTAssertTrue(state.acceptChunk(responseId: "response-1"))
        XCTAssertFalse(state.acceptChunk(responseId: "response-1"))
        state.reset()
        XCTAssertTrue(state.acceptChunk(responseId: "response-2"))
    }
}
```

- [ ] **Step 2: Verify RED**

```bash
swift test --package-path mac-adapter --filter StreamingPlaybackStateTests
```

Expected: FAIL because `StreamingPlaybackState` is missing.

- [ ] **Step 3: Implement resettable playback**

```swift
struct StreamingPlaybackState {
    private var startedResponseId: String?

    mutating func acceptChunk(responseId: String) -> Bool {
        guard startedResponseId != responseId else { return false }
        startedResponseId = responseId
        return true
    }

    mutating func reset() {
        startedResponseId = nil
    }
}
```

Add `clear()` to `StreamingAudioPlayer` that stops the player node, resets it,
then starts it again while keeping the engine available. Add an
`onFirstScheduledBuffer` callback guarded by `StreamingPlaybackState`. Reset the
state from `clear()` and `stop()`.

- [ ] **Step 4: Run playback and full Swift tests**

```bash
swift test --package-path mac-adapter --filter StreamingPlaybackStateTests
swift test --package-path mac-adapter
```

Expected: focused and full Swift suites pass.

- [ ] **Step 5: Commit playback changes**

```bash
git add mac-adapter/Sources/Audio/StreamingAudioPlayer.swift mac-adapter/Sources/Audio/StreamingPlaybackState.swift mac-adapter/Tests/StreamingPlaybackStateTests.swift
git commit -m "feat(voice): interrupt streamed response audio"
```

### Task 7: Add one updateable streamed answer card

**Files:**
- Modify: `mac-adapter/Sources/UI/AugmentPanel.swift:1-330`
- Modify: `mac-adapter/Tests/AugmentPanelTests.swift`
- Modify: `mac-adapter/Sources/UI/InvocationPanel.swift:4-170`

- [ ] **Step 1: Add failing presentation-policy tests**

```swift
func testStreamingContentAccumulatesIntoOneCard() {
    var content = StreamingAnswerContent()
    XCTAssertEqual(content.append("Let me "), "Let me ")
    XCTAssertEqual(content.append("think about this."), "Let me think about this.")
    XCTAssertEqual(content.final, "Let me think about this.")
}

func testStaleDeltaDoesNotChangeContent() {
    var content = StreamingAnswerContent(turnId: "turn-2")
    XCTAssertNil(content.append("old", turnId: "turn-1"))
    XCTAssertEqual(content.final, "")
}
```

- [ ] **Step 2: Verify RED**

```bash
swift test --package-path mac-adapter --filter AugmentPanelTests
```

Expected: FAIL because `StreamingAnswerContent` is missing.

- [ ] **Step 3: Implement in-place streamed content**

Add a pure `StreamingAnswerContent` value type and:

```swift
func updateStreamingContent(_ content: String) {
    guard let label = contentLabel else { return }
    label.attributedStringValue = Self.answerText(content)
    resizeStreamingContent(content)
}
```

Extract the answer attributes already used by `show()` into
`static func answerText(_:)`. `resizeStreamingContent` recalculates
`contentLayout`, updates the label/document view height, and grows the panel up
to `maximumVisibleContentHeight` without dismissing or recreating it.

Add `InvocationPanel.State.responding` with title `Flyd` and a pulsing brass
status dot. It must not contain a spoken or textual canned acknowledgement.

- [ ] **Step 4: Run UI tests**

```bash
swift test --package-path mac-adapter --filter AugmentPanelTests
```

Expected: all Augment panel tests pass, including scrolling and accumulation.

- [ ] **Step 5: Commit streamed presentation**

```bash
git add mac-adapter/Sources/UI/AugmentPanel.swift mac-adapter/Sources/UI/InvocationPanel.swift mac-adapter/Tests/AugmentPanelTests.swift
git commit -m "feat(voice): stream one live answer card"
```

### Task 8: Route `⌃fn` through Realtime without affecting dictation

**Files:**
- Create: `mac-adapter/Sources/Bridge/PushToTalkSessionController.swift`
- Create: `mac-adapter/Sources/Bridge/RealtimeToolCoordinator.swift`
- Create: `mac-adapter/Tests/PushToTalkSessionControllerTests.swift`
- Modify: `mac-adapter/Sources/main.swift:55-470`
- Modify: `mac-adapter/Sources/Bridge/LiveSessionController.swift:1-110`

- [ ] **Step 1: Write the failing route policy test**

```swift
import XCTest
@testable import FlydMacAdapter

final class PushToTalkSessionControllerTests: XCTestCase {
    func testConversationUsesRealtimeAndDictationUsesTranscription() {
        XCTAssertEqual(
            VoiceConversationRoute.path(for: .conversation),
            .realtime
        )
        XCTAssertEqual(
            VoiceConversationRoute.path(for: .dictation),
            .transcription
        )
    }

    func testRealtimeConversationNeverRequestsTTS() {
        XCTAssertFalse(
            VoiceConversationRoute.shouldRequestTTS(
                purpose: .conversation,
                path: .realtime
            )
        )
    }

    func testRealtimeFailureDoesNotSelectFullAnswerTTSFallback() {
        XCTAssertEqual(
            VoiceConversationRoute.failureAction(for: .realtime),
            .showErrorAndReconnect
        )
    }
}
```

- [ ] **Step 2: Verify RED**

```bash
swift test --package-path mac-adapter --filter PushToTalkSessionControllerTests
```

Expected: FAIL because `VoiceConversationRoute` is missing.

- [ ] **Step 3: Implement the controller and main routing**

Add:

```swift
enum VoiceConversationPath: Equatable {
    case realtime
    case transcription
}

enum VoiceConversationFailureAction: Equatable {
    case showErrorAndReconnect
    case showError
}

enum VoiceConversationRoute {
    static func path(for purpose: VoiceInvocationPurpose) -> VoiceConversationPath {
        switch purpose {
        case .conversation: return .realtime
        case .dictation: return .transcription
        }
    }

    static func shouldRequestTTS(
        purpose: VoiceInvocationPurpose,
        path: VoiceConversationPath
    ) -> Bool {
        switch (purpose, path) {
        case (.conversation, .realtime): return false
        default: return true
        }
    }

    static func failureAction(
        for path: VoiceConversationPath
    ) -> VoiceConversationFailureAction {
        path == .realtime ? .showErrorAndReconnect : .showError
    }
}
```

`PushToTalkSessionController` owns a `PushToTalkTurnGate`, the shared
`LiveAudioBridge`, one `StreamingAudioPlayer`, accumulated transcript text, and
latency timestamps. Its public surface is:

```swift
func warm(conversationId: String)
func startTurn(invocationId: String)
func receiveCapturedAudio(_ data: Data)
func releaseTurn()
func cancel()
```

Apply `PushToTalkEffect` values to bridge sends and playback cleanup. Accept
audio/transcript events only when the gate accepts their `turn_id`. On the first
audio buffer, log release-to-first-audio latency. Update one `AugmentPanel` as
transcript deltas arrive. On `response_done`, retain completed text and return
Flyd state to `.present`.

Call `pushToTalkController.warm(conversationId: voiceConversationId)` after
Flyd Core reports healthy during app startup; warming opens the socket but does
not start `VoiceCapture`. On bridge failure, stop and clear playback, show
`"Voice connection failed - try again"`, and schedule a reconnect. Do not call
`processInvocation`, `FlydClient.speak` (the `/tts` path), or `SpeechPlayer` as
a fallback.

In `main.swift`:

```swift
switch VoiceConversationRoute.path(for: purpose) {
case .realtime:
    beginRealtimeVoiceInvocation()
case .transcription:
    beginVoiceInvocation(purpose: .dictation)
}
```

On release, call the Realtime controller for conversation and keep the current
`voiceRelay.commitAudio()` path for dictation. Remove conversation calls to
`processInvocation(... modality: "voice" ...)`; retain them for other
modalities. Do not change `processDictation`.

Move the existing observation capture, `ObservedTarget` storage, resolution
decoding, confirmation, and verified native execution from
`LiveSessionController` into `RealtimeToolCoordinator`. Give it this interface:

```swift
final class RealtimeToolCoordinator {
    static let shared = RealtimeToolCoordinator()

    func handleObservationRequest(
        _ json: [String: Any],
        reply: (String) -> Void
    )

    func handleResolutionResult(_ json: [String: Any])

    func reset()
}
```

Both `LiveSessionController` and `PushToTalkSessionController` assign their
bridge callbacks to this shared coordinator. `handleObservationRequest` calls
the supplied `reply` with the serialized observation message. Move the existing
`executeLiveNative` and confirmation body without changing its target
verification or consequence checks; rename user-facing/log strings from
`LIVE` to `Realtime`. `reset()` cancels its task and clears observed targets.

- [ ] **Step 4: Run routing and full suites**

```bash
swift test --package-path mac-adapter --filter PushToTalkSessionControllerTests
swift test --package-path mac-adapter --filter ShortcutRoutingTests
npm test --prefix cli
swift test --package-path mac-adapter
```

Expected: all commands pass. The Core count includes the new protocol tests;
Swift includes route, bridge, playback, and turn-gate tests.

- [ ] **Step 5: Commit adapter integration**

```bash
git add mac-adapter/Sources/Bridge/PushToTalkSessionController.swift mac-adapter/Sources/Bridge/RealtimeToolCoordinator.swift mac-adapter/Tests/PushToTalkSessionControllerTests.swift mac-adapter/Sources/main.swift mac-adapter/Sources/Bridge/LiveSessionController.swift
git commit -m "feat(voice): stream conversation through realtime"
```

### Task 9: Verify latency, one voice, interruption, and installation

**Files:**
- Modify only files required by failures attributable to this feature.

- [ ] **Step 1: Run fresh automated verification**

```bash
npm test --prefix cli
swift test --package-path mac-adapter
git diff --check
```

Expected: all tests pass and `git diff --check` has no output.

- [ ] **Step 2: Build and install the macOS app**

```bash
cd mac-adapter
make run
```

Expected: release build succeeds, Flyd is installed to
`~/Applications/Flyd.app`, and the installed process launches.

- [ ] **Step 3: Verify installed services**

```bash
curl -fsS http://127.0.0.1:4815/health
pgrep -fl '/Users/radarboy3000/Applications/Flyd.app/Contents/MacOS/FlydMacAdapter'
tail -n 80 ~/.flyd/overlay/core-launch.log
```

Expected: health is `ok`, one installed adapter process is running, ports
4815–4817 start once, and the Realtime socket reports ready without access
errors.

- [ ] **Step 4: Perform the real shortcut acceptance test**

Use `⌃fn` for two turns:

1. Ask a simple question. Confirm the answer begins audibly before its final
   transcript is complete.
2. Ask a harder question. A brief natural lead-in is allowed, but it must come
   from the same voice and continue into the answer.
3. Press `⌃fn` during the second answer. Confirm old audio stops immediately and
   never resumes.
4. Use `⇧⌃fn` in an editable field. Confirm literal dictation remains isolated.

Inspect the new latency log and confirm release-to-first-audio is recorded. The
target is at most 1.5 seconds on a warm connection under normal network
conditions.

- [ ] **Step 5: Record final source state**

```bash
git status --short
git log -10 --oneline
```

Expected: only the user's pre-existing retrieval/currentness changes remain
uncommitted. Report those files separately; do not stage them.
