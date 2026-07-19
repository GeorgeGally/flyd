require "test_helper"

class IntelligenceState::RuntimeTaskProviderTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Runtime provider #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(
      intended_outcome: "Give Rails the complete runtime picture",
      success_criteria: [ "Rails can inspect and control the task" ]
    )
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
    @assignment = @task.task_assignments.create!(
      title: "Build Rails parity",
      instructions: "Expose the authoritative runtime without duplicating it.",
      success_criteria: [ "One task scene" ],
      declared_file_scope: [ "app/**" ]
    )
  end

  test "projects one bounded canonical task graph as provider evidence" do
    artifact = @task.task_artifacts.create!(
      task_assignment: @assignment,
      kind: "diff",
      title: "Verified patch",
      media_type: "text/x-diff",
      byte_size: 5,
      sha256_digest: Digest::SHA256.hexdigest("patch"),
      verification_status: "verified",
      source_revision: @task.revision,
      content: "patch"
    )

    snapshot = IntelligenceState::RuntimeTaskProvider.new.snapshot

    assert snapshot.fresh
    assert snapshot.snapshot_id
    assert_equal @task.task_key, snapshot.data.dig(:runtime_tasks, 0, :id)
    assert_equal @grant.grant_key, snapshot.data.dig(:task_grants, 0, :id)
    assert_equal @assignment.assignment_key, snapshot.data.dig(:task_assignments, 0, :id)
    assert_equal artifact.artifact_key, snapshot.data.dig(:task_artifacts, 0, :id)
    assert_nil snapshot.data.dig(:task_artifacts, 0, :content, :content)
  end

  test "omits rejected artifacts from interface evidence" do
    @task.task_artifacts.create!(
      kind: "log",
      title: "Rejected worker output",
      media_type: "text/plain",
      byte_size: 6,
      sha256_digest: Digest::SHA256.hexdigest("unsafe"),
      verification_status: "rejected",
      source_revision: @task.revision,
      content: "unsafe"
    )

    snapshot = IntelligenceState::RuntimeTaskProvider.new.snapshot

    assert_empty snapshot.data[:task_artifacts]
  end
end
