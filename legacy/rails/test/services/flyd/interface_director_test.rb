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
    assert_equal "build", directive.dig(:grammars, :action, :actions_by_readiness, :ready)
    assert_nil directive.dig(:grammars, :action, :actions_by_readiness, :blocked)
    assert_nil directive.dig(:grammars, :action, :actions_by_readiness, :running)
  end

  test "an unresolved choice becomes a decision interface" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ { scene_key: "decision:architecture", kind: "decision", status: "active", project_id: 1 } ],
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
        { scene_key: "decision:launch", kind: "decision", status: "active", project_id: 1 }
      ],
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
    assert_equal [ "decision", "conversation", "quiet" ], directive[:candidates].map { |candidate| candidate[:mode] }
  end

  test "a presented unresolved decision remains eligible" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ {
        scene_key: "decision:architecture", kind: "decision", status: "active", project_id: 1,
        created_at: 1.hour.ago.iso8601, last_presented_at: 30.minutes.ago.iso8601
      } ],
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
  end

  test "an explicitly expired decision scene stops driving decision candidacy" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ {
        scene_key: "decision:architecture", kind: "decision", status: "active", project_id: 1,
        created_at: 3.days.ago.iso8601,
        metadata: { expires_at: 1.minute.ago.iso8601 }
      } ],
      builds: []
    )

    assert_equal "quiet", directive[:suggested_mode]
  end

  test "a malformed explicit expiry fails closed" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ {
        scene_key: "decision:architecture", kind: "decision", status: "active", project_id: 1,
        created_at: 1.hour.ago.iso8601,
        metadata: { expires_at: "not-a-time" }
      } ],
      builds: []
    )

    assert_equal "quiet", directive[:suggested_mode]
  end

  test "a fresh unanswered decision scene earns decision candidacy" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ {
        scene_key: "decision:architecture", kind: "decision", status: "active", project_id: 1,
        created_at: 1.hour.ago.iso8601
      } ],
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
  end

  test "a runtime scene whose task is no longer live evidence earns nothing" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ {
        scene_key: "runtime:dead-task:task_plan", kind: "decision", status: "active", project_id: 1,
        created_at: 30.minutes.ago.iso8601
      } ],
      provider_state: { providers: [ { data: { runtime_tasks: [ { id: "other-live-task" } ] } } ] },
      builds: []
    )

    assert_equal "quiet", directive[:suggested_mode]
  end

  test "a runtime scene backed by a live task keeps its candidacy" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ {
        scene_key: "runtime:live-task:task_plan", kind: "decision", status: "active", project_id: 1,
        created_at: 30.minutes.ago.iso8601
      } ],
      provider_state: { providers: [ { data: { runtime_tasks: [ { id: "live-task" } ] } } ] },
      builds: []
    )

    assert_equal "decision", directive[:suggested_mode]
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
    assert_equal [ "conversation", "quiet" ], directive[:candidates].map { |candidate| candidate[:mode] }
  end

  test "provider evidence earns specific interface candidates without prebuilt scenes" do
    directive = Flyd::InterfaceDirector.call(
      builds: [],
      provider_state: {
        providers: [ {
          source: "flyd-cli",
          fresh: true,
          errors: [],
          data: {
            tensions: [ {
              id: "tension:launch", type: "tension", epistemicStatus: "observation",
              content: { blockers: 1, tension: 0.7 }
            } ],
            curiosity: [ {
              id: "curiosity:adoption", type: "curiosity", epistemicStatus: "llm_generated",
              confidence: 0.7, generatedAt: Time.current.iso8601,
              evidenceRefs: [ { type: "event", id: "event:setup" } ],
              content: { question: "Why are users abandoning setup?", missingEvidence: "Recent setup sessions" }
            } ],
            signals: [ {
              id: "signal:setup", type: "signal", epistemicStatus: "heuristic",
              generatedAt: Time.current.iso8601,
              content: { topic: "setup", unresolved: 2 }
            } ]
          }
        } ]
      }
    )

    assert_equal "decision", directive[:suggested_mode]
    assert_equal %w[decision investigation monitoring quiet], directive[:candidates].map { |candidate| candidate[:mode] }
    assert_equal [ { type: "tension", id: "tension:launch" } ], directive[:candidates].first[:evidence_refs]
  end

  test "ownerless generated scenes do not perpetuate themselves" do
    directive = Flyd::InterfaceDirector.call(
      scenes: [ { scene_key: "curiosity:stale", kind: "investigation", status: "active" } ],
      builds: [],
      provider_state: { providers: [] }
    )

    assert_equal "quiet", directive[:suggested_mode]
    assert_equal [ "quiet" ], directive[:candidates].map { |candidate| candidate[:mode] }
  end

  test "quiet is valid when nothing has earned the screen" do
    directive = Flyd::InterfaceDirector.call(builds: [])

    assert_equal "quiet", directive[:suggested_mode]
    assert_equal 1, directive.dig(:grammars, :quiet, :maximum_items)
  end

  test "grounded personal knowledge earns discovery above quiet" do
    directive = Flyd::InterfaceDirector.call(
      builds: [],
      provider_state: {
        providers: [ {
          data: {
            reports: [ {
              id: "report:memex",
              type: "report",
              epistemicStatus: "observation",
              confidence: 0.8,
              content: { title: "The memex", excerpt: "Associative trails anticipated hypertext." }
            } ]
          }
        } ]
      }
    )

    assert_equal "discovery", directive[:suggested_mode]
    assert_equal [ "discovery", "quiet" ], directive[:candidates].map { |candidate| candidate[:mode] }
    assert_equal "discovery_scene", directive.dig(:grammars, :discovery, :focus_renderer)
    assert_equal 4, directive.dig(:grammars, :discovery, :maximum_items)
  end

  test "ready work still outranks discovery" do
    directive = Flyd::InterfaceDirector.call(
      active_intent: { requested_capability: "build" },
      builds: [],
      provider_state: {
        providers: [ {
          data: {
            reports: [ {
              id: "report:memex", type: "report", epistemicStatus: "observation", confidence: 0.8,
              content: { title: "The memex", excerpt: "Associative trails anticipated hypertext." }
            } ]
          }
        } ]
      }
    )

    assert_equal "action", directive[:suggested_mode]
    assert_equal [ "action", "discovery", "quiet" ], directive[:candidates].map { |candidate| candidate[:mode] }
  end
end
