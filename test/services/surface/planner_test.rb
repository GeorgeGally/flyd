require "test_helper"

class Flyd::IntelligenceTest < ActiveSupport::TestCase
  FakeChat = Struct.new(:response, :received_messages) do
    def call!(messages)
      self.received_messages = messages
      response
    end
  end

  SequenceChat = Struct.new(:responses, :received_calls) do
    def call!(messages)
      self.received_calls ||= []
      received_calls << messages
      responses.shift
    end
  end

  FakeStateProvider = Struct.new(:payload) do
    def snapshot = payload
  end

  test "Flyd chooses and composes the interface required by the situation" do
    project = Project.create!(name: "Flyd", description: "Personal intelligence")
    Scene.create!(
      scene_key: "interface-drift",
      kind: "decision",
      status: "active",
      title: "What should become the primary interface?",
      summary: "Choose whether Flyd directs the surface or remains a conversation shell.",
      project: project
    )
    response = {
      understanding: "The implementation has drifted back toward chat-first interaction.",
      current_intention: "Put the architectural choice directly on screen.",
      surface_mode: "decision",
      focus_item_id: "interface-drift",
      items: [ {
        id: "interface-drift",
        kind: "decision",
        intent: "decide",
        title: "What should become the primary interface?",
        summary: "Choose whether Flyd directs the surface or remains a conversation shell.",
        renderer: "decision_scene",
        depth: "foreground",
        context_refs: [ { type: "project", id: project.id } ],
        source_refs: [ { type: "goal", id: "goal:ship-flyd" } ],
        metadata: {
          options: [
            { id: "director", label: "Dynamic director", description: "The interface changes around the situation." },
            { id: "shell", label: "Conversation shell", description: "The last conversation remains primary." }
          ],
          recommendation: "Use the dynamic director."
        },
        actions: [
          { id: "choose", label: "Choose dynamic director", payload: { option_id: "director", option_label: "Dynamic director" } },
          { id: "choose", label: "Choose conversation shell", payload: { option_id: "shell", option_label: "Conversation shell" } }
        ]
      } ],
      relationships: []
    }.to_json
    chat = FakeChat.new(response)
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          goals: [ {
            id: "goal:ship-flyd",
            type: "goal",
            source: "test",
            epistemicStatus: "user_confirmed",
            confidence: 0.9,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: { slug: "ship-flyd" }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider).compose_surface
    sent_state = JSON.parse(chat.received_messages.last[:content])

    assert_equal "decision", surface.surface_mode
    assert_equal "interface-drift", surface.focus_item_id
    assert_equal "decision_scene", surface.items.first.renderer
    assert_equal "ship-flyd", sent_state.dig("provider_state", "providers", 0, "data", "goals", 0, "content", "slug")
    assert_equal "decision", sent_state.dig("interface_direction", "suggested_mode")
    assert_equal "interface-drift", sent_state.dig("interface_direction", "suggested_focus_scene_key")
    assert_equal "Make the choice itself the interface.", sent_state.dig("interface_direction", "grammars", "decision", "purpose")
    assert_includes chat.received_messages.first[:content], '"attachment_id":"optional exact intent attachment id"'
  end

  test "provider evidence composes a directed surface without a prebuilt scene" do
    response = {
      understanding: "Setup abandonment is unresolved and the current explanation lacks direct observations.",
      current_intention: "Investigate the exact point where setup loses users.",
      surface_mode: "investigation",
      focus_item_id: "investigation:setup-abandonment",
      items: [ {
        id: "investigation:setup-abandonment",
        kind: "question",
        intent: "investigate",
        title: "Where does setup lose people?",
        summary: "The current evidence points to broad choices, but no recent setup-session observations confirm the cause.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [
          { type: "curiosity", id: "curiosity:adoption" },
          { type: "signal", id: "signal:setup" }
        ],
        metadata: {
          known: [ "Users face a broad set of setup choices." ],
          unknown: [ "The exact step where users abandon setup." ],
          next_question: "Which setup step has the highest abandonment rate?"
        },
        actions: [ {
          id: "investigate",
          label: "Investigate setup sessions",
          payload: { question: "Which setup step has the highest abandonment rate?" }
        } ]
      } ],
      relationships: []
    }.to_json
    chat = FakeChat.new(response)
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          curiosity: [ {
            id: "curiosity:adoption",
            type: "curiosity",
            source: "test",
            epistemicStatus: "llm_generated",
            confidence: 0.7,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: {
              question: "Why are users abandoning setup?",
              missingEvidence: "Recent setup-session observations"
            }
          } ],
          signals: [ {
            id: "signal:setup",
            type: "signal",
            source: "test",
            epistemicStatus: "heuristic",
            confidence: 0.6,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: { topic: "setup", unresolved: 2 }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider).compose_surface
    sent_state = JSON.parse(chat.received_messages.last[:content])
    system_prompt = chat.received_messages.first[:content]

    assert_equal "investigation", surface.surface_mode
    assert_equal "investigation_scene", surface.items.first.renderer
    assert_equal [ "curiosity", "signal" ], surface.items.first.source_refs.map { |reference| reference["type"] }
    assert_not_equal "quiet:available", surface.focus_item_id
    assert_not_equal "What deserves your attention?", surface.items.first.title
    assert_includes sent_state.dig("interface_direction", "candidates").map { |candidate| candidate["mode"] }, "investigation"
    assert_includes system_prompt, "Quiet is valid only when no candidate evidence supports a concrete present situation."
    assert_includes system_prompt, "candidate evidence_refs"
    assert_includes system_prompt, 'investigate action payload must be {"question":"metadata.next_question"}'
  end

  test "repairs one structurally invalid directed surface" do
    invalid_response = {
      understanding: "The setup problem needs investigation.",
      current_intention: "Find the abandonment point.",
      surface_mode: "investigation",
      focus_item_id: "curiosity:adoption",
      items: [ {
        id: "curiosity:adoption",
        kind: "curiosity",
        intent: "investigate",
        title: "Where does setup lose people?",
        summary: "Recent setup observations are missing.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "curiosity", id: "curiosity:adoption" } ],
        metadata: {
          known: [ "Setup offers broad choices." ],
          unknown: [ "The abandonment point." ],
          next_question: "Which setup step loses users?"
        },
        actions: [ { id: "investigate", label: "Investigate", payload: {} } ]
      } ],
      relationships: []
    }.to_json
    corrected_response = {
      understanding: "The setup problem needs investigation.",
      current_intention: "Find the abandonment point.",
      surface_mode: "investigation",
      focus_item_id: "investigation:setup",
      items: [ {
        id: "investigation:setup",
        kind: "question",
        intent: "investigate",
        title: "Where does setup lose people?",
        summary: "Recent setup observations are missing.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "curiosity", id: "curiosity:adoption" } ],
        metadata: {
          known: [ "Setup offers broad choices." ],
          unknown: [ "The abandonment point." ],
          next_question: "Which setup step loses users?"
        },
        actions: [ {
          id: "investigate",
          label: "Investigate",
          payload: { question: "Which setup step loses users?" }
        } ]
      } ],
      relationships: []
    }.to_json
    chat = SequenceChat.new([ invalid_response, corrected_response ])
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          curiosity: [ {
            id: "curiosity:adoption",
            type: "curiosity",
            source: "test",
            epistemicStatus: "llm_generated",
            confidence: 0.7,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: {
              question: "Why are users abandoning setup?",
              missingEvidence: "Recent setup-session observations"
            }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface

    assert_equal "investigation", surface.surface_mode
    assert_equal "question", surface.items.first.kind
    assert_equal 2, chat.received_calls.length
    repair_request = chat.received_calls.second.last[:content]
    assert_includes repair_request, "Unsupported kind: curiosity"
    assert_includes repair_request, "Investigation requires a question"
  end

  test "raises when the single structural repair is still invalid" do
    invalid_response = {
      understanding: "A question exists.",
      current_intention: "Investigate it.",
      surface_mode: "investigation",
      focus_item_id: "curiosity:adoption",
      items: [ {
        id: "curiosity:adoption",
        kind: "curiosity",
        intent: "investigate",
        title: "What is happening?",
        summary: "The evidence is incomplete.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "curiosity", id: "curiosity:adoption" } ],
        metadata: { known: [ "A symptom exists." ], unknown: [ "Its cause." ], next_question: "Why?" },
        actions: [ { id: "investigate", label: "Investigate", payload: {} } ]
      } ],
      relationships: []
    }.to_json
    chat = SequenceChat.new([ invalid_response, invalid_response ])
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          curiosity: [ {
            id: "curiosity:adoption",
            type: "curiosity",
            source: "test",
            epistemicStatus: "llm_generated",
            confidence: 0.7,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: { question: "Why?", missingEvidence: "Direct observation" }
          } ]
        }
      } ]
    })

    assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface
    end
    assert_equal 2, chat.received_calls.length
  end

  test "falls back without ranking database records when composition fails" do
    provider = FakeStateProvider.new({ providers: [] })
    surface = Flyd::Intelligence.new(chat: FakeChat.new("not json"), state_provider: provider).compose_surface

    assert_equal "quiet", surface.surface_mode
    assert_equal "quiet:available", surface.focus_item_id
    assert_equal 1, surface.items.length
    assert_empty surface.items.first.source_refs
  end

  test "stays intentionally quiet without asking the model to invent relevance" do
    chat = FakeChat.new("must not be called")
    provider = FakeStateProvider.new({ providers: [] })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface

    assert_equal "quiet", surface.surface_mode
    assert_equal "quiet:available", surface.focus_item_id
    assert_nil chat.received_messages
    assert_equal "Nothing has earned the screen yet.", surface.understanding
  end
end
