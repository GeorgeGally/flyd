require "test_helper"

class WorkerSessionTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Worker session #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Run one worker")
    @grant = @task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )
  end

  test "Rails treats persisted workers as read-only projections" do
    worker = @task.worker_sessions.create!(
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
      task_grant: other_grant,
      adapter: "opencode",
      working_directory: Dir.home
    )

    assert_not worker.valid?
    assert_includes worker.errors[:task_grant], "must belong to the same task"
  end
end
