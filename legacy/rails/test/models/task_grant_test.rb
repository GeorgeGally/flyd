require "test_helper"

class TaskGrantTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Task grant #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Run approved work")
  end

  test "approval freezes the exact worker scope" do
    grant = @task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      file_operations: [ "read", "write" ],
      command_classes: [ "test", "git_status" ],
      verification_commands: [ "git diff --check" ],
      renewal_required_actions: [ "deploy", "publish" ],
      expires_at: 8.hours.from_now
    )

    assert_equal "approved", grant.status
    assert grant.approved_at.present?
    assert grant.scope_digest.present?
    assert_raises(ActiveRecord::RecordInvalid) { grant.update!(repository_roots: [ "/tmp" ]) }
  end

  test "only one approved grant exists for a task" do
    @task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )
    second = @task.task_grants.new(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 8.hours.from_now
    )

    assert_raises(ActiveRecord::RecordInvalid) { second.save! }
  end

  test "approved grants require a bounded expiry and verification command" do
    grant = @task.task_grants.new(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ Dir.home ],
      worker_adapters: [ "opencode" ]
    )

    assert_not grant.valid?
    assert_includes grant.errors[:expires_at], "can't be blank"
    assert_includes grant.errors[:verification_commands], "can't be blank"
  end

  test "persisted grants are read-only projections" do
    grant = @task.task_grants.create!(
      repository_roots: [ Dir.home ],
      worker_adapters: [ "opencode" ],
      verification_commands: [ "git diff --check" ],
      expires_at: 1.minute.from_now
    )

    assert_raises(ActiveRecord::ReadOnlyRecord) { grant.update!(status: "approved") }
  end
end
