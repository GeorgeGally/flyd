require "test_helper"

class Flyd::InterfaceDirectorTest < ActiveSupport::TestCase
  test "ready work takes the surface instead of passive continuity" do
    directive = Flyd::InterfaceDirector.call(
      active_interaction: { id: 1 },
      active_intent: { requested_capability: "build" },
      builds: []
    )

    assert_equal "action", directive[:suggested_mode]
    assert_equal "action_scene", directive.dig(:grammars, :action, :focus_renderer)
  end

  test "an unresolved choice becomes a decision interface" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [{ scene_key: "decision:architecture", kind: "decision", status: "active" }],
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
    assert_equal "decision:architecture", directive[:suggested_focus_scene_key]
    assert_equal "choose", directive.dig(:grammars, :decision, :required_action)
  end

  test "an unresolved decision outranks a newer conversation" do
    directive = Flyd::InterfaceDirector.call(
      active_interaction: { id: 1 },
      scenes: [
        { scene_key: "conversation:1", kind: "conversation", status: "active" },
        { scene_key: "decision:launch", kind: "decision", status: "active" }
      ],
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
    assert_equal ["decision", "conversation", "quiet"], directive[:candidates].map { |candidate| candidate[:mode] }
  end

  test "uncertainty becomes an investigation interface" do
    directive = Flyd::InterfaceDirector.call(
      active_intent: { requested_capability: "investigate" },
      builds: []
    )

    assert_equal "investigation", directive[:suggested_mode]
    assert_equal "investigation_scene", directive.dig(:grammars, :investigation, :focus_renderer)
  end

  test "conversation is only a lower-priority candidate" do
    directive = Flyd::InterfaceDirector.call(
      active_interaction: { id: 1 },
      builds: []
    )

    assert_equal "conversation", directive[:suggested_mode]
    assert_equal ["conversation", "quiet"], directive[:candidates].map { |candidate| candidate[:mode] }
  end

  test "quiet is valid when nothing has earned the screen" do
    directive = Flyd::InterfaceDirector.call(builds: [])

    assert_equal "quiet", directive[:suggested_mode]
    assert_equal 1, directive.dig(:grammars, :quiet, :maximum_items)
  end
end
