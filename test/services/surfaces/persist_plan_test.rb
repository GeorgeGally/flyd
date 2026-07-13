require "test_helper"

class Surfaces::PersistPlanTest < ActiveSupport::TestCase
  Item = Data.define(:id, :kind, :intent, :renderer, :depth, :state, :title, :summary, :context_refs, :source_refs, :actions)
  Plan = Data.define(:generated_at, :understanding, :current_intention, :focus_item_id, :items)

  test "persists a semantic plan as an inactive draft" do
    plan = Plan.new(
      generated_at: Time.current,
      understanding: "A cross-project issue needs resolution.",
      current_intention: "Help the user decide.",
      focus_item_id: "decision-scene",
      items: [
        Item.new(
          id: "decision-scene",
          kind: "scene",
          intent: "decide",
          renderer: "hero_scene",
          depth: "foreground",
          state: "presented",
          title: "One decision now matters",
          summary: "Resolve the architecture before adding more interface work.",
          context_refs: [{ type: "project", id: 1 }],
          source_refs: [{ type: "goal", id: "ship-flyd" }],
          actions: [{ id: "discuss", label: "Discuss" }]
        )
      ]
    )

    surface = Surfaces::PersistPlan.call(plan: plan, source_state_digest: "abc123")

    assert_equal "draft", surface.status
    assert_equal "abc123", surface.source_state_digest
    assert_equal "decision-scene", surface.focus_item_key
    assert_equal "One decision now matters", surface.surface_items.first.title
    assert_nil Surface.current
  end
end
