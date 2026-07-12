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

  test "Flyd composes a synthesized surface from bounded canonical intelligence state" do
    project = Project.create!(name: "Flyd", description: "Personal intelligence")
    response = {
      understanding: "The implementation has drifted back toward chat-first interaction.",
      current_intention: "Help George decide the next architectural correction.",
      surface_mode: "decision",
      focus_item_id: "interface-drift",
      items: [{
        id: "interface-drift",
        kind: "scene",
        intent: "decide",
        title: "The interface has become the product again",
        summary: "The surface should be generated from Flyd's whole understanding, not directly from stored records.",
        renderer: "hero_scene",
        depth: "foreground",
        context_refs: [{ type: "project", id: project.id }],
        source_refs: [{ type: "goal", id: "goal:ship-flyd" }],
        actions: [{ id: "discuss", label: "Discuss" }]
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

    assert_equal "interface-drift", surface.focus_item_id
    assert_equal "Help George decide the next architectural correction.", surface.current_intention
    assert_equal "ship-flyd", sent_state.dig("provider_state", "providers", 0, "data", "goals", 0, "content", "slug")
    assert_equal [{ "type" => "goal", "id" => "goal:ship-flyd" }], surface.items.first.source_refs
  end

  test "falls back without ranking database records when composition fails" do
    provider = FakeStateProvider.new({ providers: [] })
    surface = Flyd::Intelligence.new(chat: FakeChat.new("not json"), state_provider: provider).compose_surface

    assert_equal "continue", surface.focus_item_id
    assert_equal 1, surface.items.length
    assert_empty surface.items.first.source_refs
  end
end
