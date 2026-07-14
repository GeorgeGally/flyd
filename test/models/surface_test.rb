require "test_helper"

class SurfaceTest < ActiveSupport::TestCase
  test "fallback creates one active persisted surface" do
    surface = Surface.fallback!

    assert surface.persisted?
    assert surface.active?
    assert_equal "continue", surface.focus_item_key
    assert_equal 1, surface.surface_items.count
    assert_equal surface, Surface.current
    assert_equal "Ready when you are.", surface.items.first.title
    assert_equal "Ask, tell, or show Flyd what changed.", surface.items.first.summary
  end

  test "activating a draft supersedes the previous active surface" do
    previous = Surface.fallback!
    draft = build_draft(item_key: "next")

    activated = Surface.activate!(draft)

    assert activated.active?
    assert_equal previous, activated.previous_surface
    assert_equal "superseded", previous.reload.status
    assert_equal activated, Surface.current
  end

  test "invalid draft cannot replace the active surface" do
    previous = Surface.fallback!
    draft = Surface.create!(status: "draft", focus_item_key: "missing", composition_version: "1")
    draft.surface_items.create!(
      item_key: "present",
      kind: "scene",
      intent: "inform",
      renderer: "hero_scene",
      depth: "foreground",
      state: "presented",
      title: "Present"
    )

    assert_raises(ArgumentError) { Surface.activate!(draft) }

    assert_equal previous, Surface.current
    assert previous.reload.active?
    assert_equal "draft", draft.reload.status
  end

  test "only one surface can be active" do
    first = Surface.fallback!
    second = build_draft(item_key: "second")
    Surface.activate!(second)

    assert_equal 1, Surface.active.count
    assert_equal "superseded", first.reload.status
  end

  private

  def build_draft(item_key:)
    surface = Surface.create!(
      status: "draft",
      understanding: "A prepared state",
      current_intention: "Present the next scene",
      focus_item_key: item_key,
      composition_version: "1"
    )
    surface.surface_items.create!(
      item_key: item_key,
      kind: "scene",
      intent: "inform",
      renderer: "hero_scene",
      depth: "foreground",
      state: "presented",
      title: "Next scene"
    )
    surface
  end
end
