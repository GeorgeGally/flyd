require "test_helper"

class RuntimeTaskSurfaceTest < ActionDispatch::IntegrationTest
  setup do
    Surface.delete_all
    project = Project.create!(name: "Runtime surface #{SecureRandom.hex(4)}", root_path: Rails.root.to_s)
    @task = project.agent_tasks.create!(
      intended_outcome: "Make Rails a first-class Flyd coding surface",
      success_criteria: [ "The same task and controls appear in Rails and the CLI" ]
    )
    @grant = @task.task_grants.create!(
      status: "proposed",
      repository_roots: [ Rails.root.to_s ],
      worker_adapters: [ "codex" ],
      file_operations: [ "read", "write" ],
      command_classes: [ "test" ],
      verification_commands: [ "bin/rails test" ],
      provider_identity: "codex:local",
      expires_at: 1.hour.from_now
    )
    scene = Scene.create!(
      scene_key: "runtime:#{@task.task_key}:plan",
      kind: "decision",
      status: "active",
      title: @task.intended_outcome,
      project: project
    )
    surface = Surface.create!(
      status: "draft",
      understanding: "A coding plan needs permission.",
      current_intention: "Expose the exact boundary.",
      focus_item_key: scene.scene_key,
      generated_at: Time.current,
      composition_version: "runtime-test",
      metadata: { "surface_mode" => "decision" }
    )
    surface.surface_items.create!(
      scene: scene,
      item_key: scene.scene_key,
      kind: "decision",
      intent: "decide",
      renderer: "task_plan",
      depth: "foreground",
      state: "presented",
      title: @task.intended_outcome,
      summary: "Review one exact execution boundary.",
      position: 0,
      context_refs: [ { "type" => "project", "id" => project.id } ],
      source_refs: [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "task_grant", "id" => @grant.grant_key }
      ],
      metadata: { "task_revision" => @task.revision },
      actions: [
        task_action("approve_task_grant"),
        task_action("reject_task_grant")
      ]
    )
    Surface.activate!(surface)
  end

  test "renders an unframed task plan with the exact permission boundary" do
    get root_path

    assert_response :success
    assert_select "[data-runtime-task-key='#{@task.task_key}']"
    assert_select "h2", text: @task.intended_outcome
    assert_select "form[action='#{surface_item_action_path(Surface.current.items.first, action_id: "approve_task_grant")}']"
    assert_select "body", text: /bin\/rails test/
    assert_select "body", text: /Permission boundary/
  end

  test "renders stale task scenes read only" do
    AgentTask.where(id: @task.id).update_all(revision: @task.revision + 1)

    get root_path

    assert_response :success
    assert_select "body", text: /Flyd is refreshing it/
    assert_select "input[type=submit][value='Approve plan']", count: 0
  end

  private

  def task_action(id)
    {
      "id" => id,
      "label" => id == "approve_task_grant" ? "Approve plan" : "Send back",
      "payload" => {
        "task_key" => @task.task_key,
        "task_revision" => @task.revision,
        "grant_key" => @grant.grant_key
      }
    }
  end
end
