require "test_helper"

class WorkerCommandTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Worker command #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Control a worker")
    @assignment = @task.task_assignments.create!(title: "Implement", instructions: "Implement the change")
    @grant = @task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worktree_paths: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )
    @worker = @task.worker_sessions.create!(
      task_assignment: @assignment,
      task_grant: @grant,
      adapter: "opencode",
      working_directory: Dir.home
    )
  end

  test "persists an idempotent worker control as a read-only projection" do
    command = @task.worker_commands.create!(
      worker_session: @worker,
      kind: "redirect",
      payload: { "instruction" => "Focus on the failing adapter test" },
      idempotency_key: "redirect-1"
    )

    assert command.command_key.present?
    assert_equal "queued", command.status
    assert_raises(ActiveRecord::ReadOnlyRecord) { command.update!(status: "completed") }
  end

  test "rejects unsupported control kinds" do
    command = @task.worker_commands.new(
      worker_session: @worker,
      kind: "deploy",
      idempotency_key: "deploy-1"
    )

    assert_not command.valid?
    assert_includes command.errors[:kind], "is not included in the list"
  end

  test "worker must belong to the same task" do
    other_project = Project.create!(name: "Other command #{SecureRandom.hex(4)}", root_path: "/tmp")
    other_task = other_project.agent_tasks.create!(intended_outcome: "Other task")
    other_assignment = other_task.task_assignments.create!(title: "Other", instructions: "Other work")
    other_grant = other_task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ "/tmp" ],
      worktree_paths: [ "/tmp" ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )
    other_worker = other_task.worker_sessions.create!(
      task_assignment: other_assignment,
      task_grant: other_grant,
      adapter: "opencode",
      working_directory: "/tmp"
    )
    command = @task.worker_commands.new(
      worker_session: other_worker,
      kind: "stop",
      idempotency_key: "stop-other"
    )

    assert_not command.valid?
    assert_includes command.errors[:worker_session], "must belong to the same task"
  end
end
