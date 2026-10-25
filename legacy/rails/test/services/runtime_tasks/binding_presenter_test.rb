require "test_helper"

class RuntimeTasks::BindingPresenterTest < ActiveSupport::TestCase
  Item = Struct.new(:source_refs, :metadata)

  setup do
    project = Project.create!(name: "Binding project #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Present one authoritative task")
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
    mark_delivery_healthy
  end

  test "resolves only records named by persisted source references" do
    item = Item.new(
      [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "task_grant", "id" => @grant.grant_key }
      ],
      { "task_revision" => @task.revision }
    )

    binding = RuntimeTasks::BindingPresenter.call(item)

    assert_equal @task, binding.task
    assert_equal [ @grant ], binding.grants
    assert binding.controls_enabled?
  end

  test "becomes read only when the persisted scene revision is stale" do
    item = Item.new(
      [ { "type" => "runtime_task", "id" => @task.task_key } ],
      { "task_revision" => @task.revision }
    )
    AgentTask.where(id: @task.id).update_all(revision: @task.revision + 1)

    binding = RuntimeTasks::BindingPresenter.call(item)

    assert binding.stale?
    assert_not binding.controls_enabled?
  end

  test "becomes read only without a healthy runtime listener" do
    RuntimeDeliveryState.delete_all
    item = Item.new(
      [ { "type" => "runtime_task", "id" => @task.task_key } ],
      { "task_revision" => @task.revision }
    )

    binding = RuntimeTasks::BindingPresenter.call(item)

    assert binding.stale?
    assert_not binding.controls_enabled?
  end

  test "exposes a complete user-facing re-entry action" do
    AgentTask.where(id: @task.id).update_all(
      status: "ready",
      recommended_next_action: "Current repository evidence invalidated the assignment base"
    )
    item = Item.new(
      [ { "type" => "runtime_task", "id" => @task.task_key } ],
      { "task_revision" => @task.revision }
    )

    binding = RuntimeTasks::BindingPresenter.call(item)

    assert_equal(
      "The repository changed while work was running; Flyd needs to re-check the current files before continuing.",
      binding.next_action
    )
    assert_equal "Ready to resume", binding.status_label
  end

  test "rejects referenced records from another task" do
    other_project = Project.create!(name: "Other binding #{SecureRandom.hex(4)}", root_path: Dir.home)
    other_task = other_project.agent_tasks.create!(intended_outcome: "Remain separate")
    other_grant = other_task.task_grants.create!(
      status: "proposed",
      repository_roots: [ Dir.home ],
      worker_adapters: [ "codex" ],
      file_operations: [ "read" ],
      command_classes: [ "test" ],
      verification_commands: [ "bin/rails test" ],
      provider_identity: "codex:local",
      expires_at: 1.hour.from_now
    )
    item = Item.new(
      [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "task_grant", "id" => other_grant.grant_key }
      ],
      { "task_revision" => @task.revision }
    )

    error = assert_raises(RuntimeTasks::BindingPresenter::BindingError) do
      RuntimeTasks::BindingPresenter.call(item)
    end

    assert_match(/crosses task boundaries/, error.message)
  end

  test "promotes the latest verified worker result and keeps other artifacts secondary" do
    assignment = @task.task_assignments.create!(
      status: "verified",
      title: "Assess the project",
      instructions: "Return a grounded status assessment"
    )
    earlier_result = artifact_for(assignment, kind: "log", title: "Worker result", content: "Earlier assessment")
    verification = artifact_for(assignment, kind: "test", title: "git diff --check", content: "exit 0")
    latest_result = artifact_for(
      assignment,
      kind: "log",
      title: "Worker result",
      content: "## Current status\n\nRelease 1C is implemented; dogfood evidence remains."
    )
    item = Item.new(
      [
        { "type" => "runtime_task", "id" => @task.task_key },
        { "type" => "task_assignment", "id" => assignment.assignment_key },
        { "type" => "task_artifact", "id" => earlier_result.artifact_key },
        { "type" => "task_artifact", "id" => verification.artifact_key },
        { "type" => "task_artifact", "id" => latest_result.artifact_key }
      ],
      { "task_revision" => @task.revision }
    )

    binding = RuntimeTasks::BindingPresenter.call(item)

    assert_equal [ latest_result ], binding.outcome_artifacts
    assert_equal latest_result, binding.primary_outcome_artifact
    assert_equal latest_result.content, binding.primary_outcome
    assert_equal [ verification ], binding.supporting_artifacts
  end

  private

  def mark_delivery_healthy
    RuntimeDeliveryState.create!(
      listener_key: AgentRuntime::EventListener::LISTENER_KEY,
      lease_owner: "test-listener",
      lease_expires_at: 1.minute.from_now
    )
  end

  def artifact_for(assignment, kind:, title:, content:)
    @task.task_artifacts.create!(
      task_assignment: assignment,
      kind: kind,
      title: title,
      media_type: "text/plain",
      byte_size: content.bytesize,
      sha256_digest: Digest::SHA256.hexdigest(content),
      verification_status: "verified",
      source_revision: @task.revision,
      content: content,
      provenance: {}
    )
  end
end
