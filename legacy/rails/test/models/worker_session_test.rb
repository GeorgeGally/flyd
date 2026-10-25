require "test_helper"

class WorkerSessionTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Worker session #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Run one worker")
    @assignment = @task.task_assignments.create!(title: "Implement", instructions: "Run one worker")
    @grant = @task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worktree_paths: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )
  end

  test "Rails treats persisted workers as read-only projections" do
    worker = @task.worker_sessions.create!(
      task_assignment: @assignment,
      task_grant: @grant,
      adapter: "opencode",
      executable_path: "/usr/local/bin/opencode",
      executable_version: "1.17.18",
      working_directory: Dir.home,
      status: "completed",
      external_session_id: "ses_123",
      exit_status: 0,
      usage: { "events" => 3 }
    )

    assert_raises(ActiveRecord::ReadOnlyRecord) { worker.update!(status: "running") }
  end

  test "worker grant must belong to the same task" do
    other_project = Project.create!(name: "Other worker #{SecureRandom.hex(4)}", root_path: "/tmp")
    other_task = other_project.agent_tasks.create!(intended_outcome: "Other")
    other_grant = other_task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ "/tmp" ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )

    worker = @task.worker_sessions.new(
      task_assignment: @assignment,
      task_grant: other_grant,
      adapter: "opencode",
      working_directory: Dir.home
    )

    assert_not worker.valid?
    assert_includes worker.errors[:task_grant], "must belong to the same task"
  end

  test "only one live worker exists for an assignment while other assignments can run" do
    second_assignment = @task.task_assignments.create!(title: "Review", instructions: "Review independently")
    first = @task.worker_sessions.create!(
      task_assignment: @assignment,
      task_grant: @grant,
      adapter: "opencode",
      working_directory: Dir.home,
      status: "running"
    )
    second = @task.worker_sessions.create!(
      task_assignment: second_assignment,
      task_grant: @grant,
      adapter: "opencode",
      working_directory: Dir.home,
      status: "running"
    )
    duplicate = @task.worker_sessions.new(
      task_assignment: @assignment,
      task_grant: @grant,
      adapter: "opencode",
      working_directory: Dir.home,
      status: "queued"
    )

    assert first.persisted?
    assert second.persisted?
    assert_raises(ActiveRecord::RecordInvalid) { duplicate.save! }
  end

  test "grant permits a worker inside an approved managed worktree root" do
    managed_root = File.join(Dir.home, ".flyd", "runtime", "worktrees")
    @grant.repository_roots = [ "/project" ]
    @grant.worktree_paths = [ managed_root ]
    worker = @task.worker_sessions.new(
      task_assignment: @assignment,
      task_grant: @grant,
      adapter: "opencode",
      working_directory: File.join(managed_root, "task-1", "assignment-1")
    )

    assert worker.valid?, worker.errors.full_messages.to_sentence
  end

  test "grant rejects a sibling path that only shares the approved prefix" do
    managed_root = File.join(Dir.home, ".flyd", "runtime", "worktrees")
    @grant.repository_roots = [ "/project" ]
    @grant.worktree_paths = [ managed_root ]
    worker = @task.worker_sessions.new(
      task_assignment: @assignment,
      task_grant: @grant,
      adapter: "opencode",
      working_directory: "#{managed_root}-outside/task-1"
    )

    assert_not worker.valid?
    assert_includes worker.errors[:working_directory], "must be inside the task grant"
  end
end
