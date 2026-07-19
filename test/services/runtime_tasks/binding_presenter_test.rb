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

  private

  def mark_delivery_healthy
    RuntimeDeliveryState.create!(
      listener_key: AgentRuntime::EventListener::LISTENER_KEY,
      lease_owner: "test-listener",
      lease_expires_at: 1.minute.from_now
    )
  end
end
