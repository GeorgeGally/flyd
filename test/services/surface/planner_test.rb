require "test_helper"

class Flyd::IntelligenceTest < ActiveSupport::TestCase
  FakeChat = Struct.new(:response) do
    def call!(_messages) = response
  end

  test "Flyd composes a synthesized surface rather than exposing records" do
    project = Project.create!(name: "Flyd", description: "Personal intelligence")
    response = {
      understanding: "The implementation has drifted back toward chat-first interaction.",
      current_intention: "Help George decide the next architectural correction.",
      focus_item_id: "interface-drift",
      items: [
        {
          id: "interface-drift",
          kind: "scene",
          intent: "decide",
          title: "The interface has become the product again",
          summary: "The surface should be generated from Flyd's whole understanding, not directly from stored records.",
          renderer: "hero_scene",
          depth: "foreground",
          context_refs: [{ type: "project", id: project.id }],
          source_refs: [],
          actions: [{ id: "discuss", label: "Discuss" }]
        }
      ]
    }.to_json

    surface = Flyd::Intelligence.new(chat: FakeChat.new(response)).compose_surface

    assert_equal "interface-drift", surface.focus_item_id
    assert_equal "Help George decide the next architectural correction.", surface.current_intention
    assert_equal "scene", surface.items.first.kind
    assert_equal [{ type: "project", id: project.id }], surface.items.first.context_refs
  end

  test "falls back without ranking database records when composition fails" do
    surface = Flyd::Intelligence.new(chat: FakeChat.new("not json")).compose_surface

    assert_equal "continue", surface.focus_item_id
    assert_equal 1, surface.items.length
    assert_empty surface.items.first.source_refs
  end
end
