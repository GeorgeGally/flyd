require "test_helper"

class RuntimeTasks::ActionExecutorTest < ActiveSupport::TestCase
  FakeBridge = Struct.new(:requests) do
    def call(request)
      requests << request
      { "taskRevision" => request[:expectedTaskRevision] + 1 }
    end
  end

  setup do
    project = Project.create!(name: "Action project #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Control one task from Rails")
    @grant = @task.task_grants.create!(
      status: "proposed",
      repository_roots: [ Dir.home ],
      worker_adapters: [ "codex" ],
      file_operations: [ "read", "write" ],
      command_classes: [ "test" ],
      verification_commands: [ "bin/rails test" ],
      provider_identity: "codex:local",
      expires_at: 1.hour.from_now
    )
    @surface = Surface.create!(
      status: "draft",
      understanding: "A grant needs review",
      current_intention: "Get an explicit decision",
      generated_at: Time.current
    )
    RuntimeDeliveryState.create!(
      listener_key: AgentRuntime::EventListener::LISTENER_KEY,
      lease_owner: "test-listener",
      lease_expires_at: 1.minute.from_now
    )
    @bridge = FakeBridge.new([])
  end

  test "uses persisted selectors and sends the grant decision through the runtime bridge" do
    item = surface_item(
      renderer: "task_plan",
      source_refs: [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "task_grant", "id" => @grant.grant_key }
      ],
      actions: [ task_action("approve_task_grant", "grant_key" => @grant.grant_key) ]
    )
    recommendation = item.task_recommendations.create!(agent_task: @task, release_key: "release_1c",
      task_revision: @task.revision, action: "Approve", action_id: "approve_task_grant",
      action_digest: Digest::SHA256.hexdigest("approve"))

    RuntimeTasks::ActionExecutor.call(
      item: item,
      action_id: "approve_task_grant",
      bridge: @bridge
    )

    assert_equal 1, @bridge.requests.length
    assert_equal "task.approve_grant", @bridge.requests.first.fetch(:action)
    assert_equal @grant.grant_key, @bridge.requests.first.fetch(:grantKey)
    assert_equal @task.revision, @bridge.requests.first.fetch(:expectedTaskRevision)
    assert_equal "accepted", recommendation.reload.disposition
    assert recommendation.acted_at
  end

  test "accepts only the bounded user-authored redirect instruction" do
    assignment = @task.task_assignments.create!(title: "Work", instructions: "Implement", dependency_keys: [])
    grant_attributes = {
      status: "approved",
      repository_roots: [ Dir.home ],
      worker_adapters: [ "codex" ],
      file_operations: [ "read", "write" ],
      command_classes: [ "test" ],
      verification_commands: [ "bin/rails test" ],
      provider_identity: "codex:local",
      expires_at: 1.hour.from_now,
      approved_at: Time.current
    }
    grant = @task.task_grants.create!(**grant_attributes)
    worker = @task.worker_sessions.create!(
      task_grant: grant,
      task_assignment: assignment,
      status: "running",
      adapter: "codex",
      working_directory: Dir.home
    )
    item = surface_item(
      renderer: "worker_monitor",
      source_refs: [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "worker_session", "id" => worker.worker_key }
      ],
      actions: [ task_action("redirect_worker", "worker_key" => worker.worker_key) ]
    )

    RuntimeTasks::ActionExecutor.call(
      item: item,
      action_id: "redirect_worker",
      input: { instruction: "Focus the failing controller test." },
      bridge: @bridge
    )

    assert_equal "Focus the failing controller test.", @bridge.requests.first.fetch(:instruction)
    assert_raises(ArgumentError) do
      RuntimeTasks::ActionExecutor.call(
        item: item,
        action_id: "redirect_worker",
        input: { instruction: "Try again", worker_key: "forged" },
        bridge: @bridge
      )
    end
  end

  test "fails closed without invoking the bridge when the scene revision is stale" do
    item = surface_item(
      renderer: "task_plan",
      source_refs: [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "task_grant", "id" => @grant.grant_key }
      ],
      actions: [ task_action("approve_task_grant", "grant_key" => @grant.grant_key) ]
    )
    AgentTask.where(id: @task.id).update_all(revision: @task.revision + 1)

    assert_raises(ArgumentError) do
      RuntimeTasks::ActionExecutor.call(item: item, action_id: "approve_task_grant", bridge: @bridge)
    end
    assert_empty @bridge.requests
  end

  private

  def surface_item(renderer:, source_refs:, actions:)
    @surface.surface_items.create!(
      item_key: SecureRandom.uuid,
      kind: renderer == "task_plan" ? "decision" : "status",
      intent: renderer == "task_plan" ? "decide" : "monitor",
      renderer: renderer,
      depth: "foreground",
      state: "presented",
      title: "Runtime task",
      summary: "Authoritative state",
      position: 0,
      source_refs: source_refs,
      metadata: { "task_revision" => @task.revision },
      actions: actions
    )
  end

  def task_action(id, selector)
    {
      "id" => id,
      "label" => id.humanize,
      "payload" => {
        "task_key" => @task.task_key,
        "task_revision" => @task.revision
      }.merge(selector)
    }
  end
end
