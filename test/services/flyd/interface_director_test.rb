require "test_helper"

class Flyd::InterfaceDirectorTest < ActiveSupport::TestCase
  test "ready work takes the surface instead of passive continuity" do
    directive = Flyd::InterfaceDirector.call(
      current_work: { kind: "conversation" },
      active_interaction: { id: 1 },
      active_intent: { requested_capability: "build" },
      builds: []
    )

    assert_equal "action", directive[:suggested_mode]
    assert_equal "action_scene", directive.dig(:grammars, :action, :focus_renderer)
  end

  test "an unresolved choice becomes a decision interface" do
    directive = Flyd::InterfaceDirector.call(
      current_work: { kind: "decision" },
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
    assert_equal "choose", directive.dig(:grammars, :decision, :required_action)
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
