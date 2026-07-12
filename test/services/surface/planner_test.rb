require "test_helper"

class Flyd::IntelligenceTest < ActiveSupport::TestCase
  FakeChat = Struct.new(:response, :received_messages) do
    def call!(messages)
      self.received_messages = messages
      response
    end
  end

  FakeStateProvider = Struct.new(:payload) do
    def snapshot = payload
  end

  test "Flyd chooses and composes the interface required by the situation" do
    project = Project.create!(name: "Flyd", description: "Personal intelligence")
    response = {
      understanding: "The implementation has drifted back toward chat-first interaction.",
      current_intention: "Put the architectural choice directly on screen.",
      surface_mode: "decision",
      focus_item_id: "interface-drift",
      items: [{
        id: "interface-drift",
        kind: "decision",
        intent: "decide",
        title: "What should become the primary interface?",
        summary: "Choose whether Flyd directs the surface or remains a conversation shell.",
        renderer: "decision_scene",
        depth: "foreground",
        context_refs: [{ type: "project", id: project.id }],
        source_refs: [{ type: "goal", id: "goal:ship-flyd" }],
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
      }],
      relationships: []
    }.to_json
    chat = FakeChat.new(response)
    provider = FakeStateProvider.new({
      providers: [{
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          goals: [{
            id: "goal:ship-flyd",
            type: "goal",
            source: "test",
            epistemicStatus: "user_confirmed",
            confidence: 0.9,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [],
            content: { slug: "ship-flyd" }
          }]
        }
      }]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider).compose_surface
    sent_state = JSON.parse(chat.received_messages.last[:content])

    assert_equal "decision", surface.surface_mode
    assert_equal "interface-drift", surface.focus_item_id
    assert_equal "decision_scene", surface.items.first.renderer
    assert_equal "ship-flyd", sent_state.dig("provider_state", "providers", 0, "data", "goals", 0, "content", "slug")
    assert_equal "quiet", sent_state.dig("interface_direction", "suggested_mode")
    assert_equal "Make the choice itself the interface.", sent_state.dig("interface_direction", "grammars", "decision", "purpose")
  end

  test "falls back without ranking database records when composition fails" do
    provider = FakeStateProvider.new({ providers: [] })
    surface = Flyd::Intelligence.new(chat: FakeChat.new("not json"), state_provider: provider).compose_surface

    assert_equal "quiet", surface.surface_mode
    assert_equal "quiet:available", surface.focus_item_id
    assert_equal 1, surface.items.length
    assert_empty surface.items.first.source_refs
  end
end
