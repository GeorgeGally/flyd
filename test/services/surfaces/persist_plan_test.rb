require "test_helper"

class Surfaces::PersistPlanTest < ActiveSupport::TestCase
  Item = Data.define(:id, :kind, :intent, :renderer, :depth, :state, :title, :summary, :context_refs, :source_refs, :actions, :metadata)
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
          actions: [{ id: "discuss", label: "Discuss" }],
          metadata: {}
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


  test "records the exact primary runtime action offered by a Rails surface" do
    project = Project.create!(name: "Recommendation project", root_path: "/tmp/recommendation-project")
    task = project.agent_tasks.create!(intended_outcome: "Approve a bounded task", revision: 3)
    grant = task.task_grants.create!(status: "proposed", repository_roots: [ project.root_path ],
      worker_adapters: [ "codex" ], file_operations: [ "read", "write" ], command_classes: [ "test" ],
      verification_commands: [ "bin/rails test" ], provider_identity: "codex-local", expires_at: 1.hour.from_now)
    action = { "id" => "approve_task_grant", "label" => "Approve", "payload" => {
      "task_key" => task.task_key, "task_revision" => task.revision, "grant_key" => grant.grant_key
    } }
    plan = Plan.new(generated_at: Time.current, understanding: "A grant is ready", current_intention: "Decide",
      focus_item_id: "runtime-plan", items: [ Item.new(id: "runtime-plan", kind: "decision", intent: "decide",
        renderer: "task_plan", depth: "foreground", state: "presented", title: "Approve work", summary: "Bounded work",
        context_refs: [], source_refs: [ { "type" => "runtime_task", "id" => task.task_key },
          { "type" => "task_grant", "id" => grant.grant_key } ], actions: [ action ],
        metadata: { "task_revision" => task.revision }) ])

    surface = Surfaces::PersistPlan.call(plan: plan)
    recommendation = surface.surface_items.first.task_recommendations.sole

    assert_equal task, recommendation.agent_task
    assert_equal "approve_task_grant", recommendation.action_id
    assert_equal "offered", recommendation.disposition
    assert_equal task.revision, recommendation.task_revision
  end
end
