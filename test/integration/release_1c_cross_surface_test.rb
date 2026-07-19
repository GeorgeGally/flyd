require "test_helper"

class Release1cCrossSurfaceTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "Rails evidence and the TypeScript command service expose one task revision and graph" do
    project = Project.create!(
      name: "Release 1C parity #{SecureRandom.hex(6)}",
      root_path: Rails.root.to_s
    )
    task = project.agent_tasks.create!(intended_outcome: "Prove Rails and CLI parity")
    grant = task.task_grants.create!(
      status: "proposed",
      repository_roots: [ Rails.root.to_s ],
      worker_adapters: [ "codex" ],
      file_operations: [ "read", "write" ],
      command_classes: [ "test" ],
      verification_commands: [ "bin/rails test" ],
      provider_identity: "codex:local",
      expires_at: 1.hour.from_now
    )
    artifact = task.task_artifacts.create!(
      kind: "test",
      title: "Verified Rails tests",
      media_type: "text/plain",
      byte_size: 6,
      sha256_digest: Digest::SHA256.hexdigest("passed"),
      verification_status: "verified",
      source_revision: task.revision,
      content: "passed"
    )
    correction = task.task_corrections.create!(
      original_claim: "Rails is secondary",
      corrected_value: "Rails is a first-class surface",
      task_revision: task.revision + 1,
      surface_revision: 7
    )

    database = ActiveRecord::Base.connection_db_config.database
    previous_url = ENV["FLYD_DATABASE_URL"]
    previous_flyd_dir = ENV["FLYD_DIR"]
    flyd_dir = Dir.mktmpdir("flyd-release-1c")
    ENV["FLYD_DATABASE_URL"] = "postgres:///#{database}"
    ENV["FLYD_DIR"] = flyd_dir
    bridge = AgentRuntime::Bridge.new(bridge_path: Rails.root.join("cli/dist/not-built-runtime-bridge.js"))
    cli_status = bridge.call(
      schemaVersion: 1,
      action: "task.status",
      actorSurface: "rails",
      taskKey: task.task_key
    )
    rails_state = IntelligenceState::RuntimeTaskProvider.new.snapshot

    assert_equal task.task_key, cli_status.dig("data", "task", "taskKey")
    assert_equal task.revision, cli_status["taskRevision"]
    assert_equal grant.grant_key, cli_status.dig("data", "grants", 0, "grantKey")
    assert_equal artifact.artifact_key, cli_status.dig("data", "artifacts", 0, "artifactKey")
    assert_equal correction.correction_key, cli_status.dig("data", "corrections", 0, "correctionKey")
    assert_equal task.task_key, rails_state.data.dig(:runtime_tasks, 0, :id)
    assert_equal artifact.artifact_key, rails_state.data.dig(:task_artifacts, 0, :id)
    assert_equal correction.correction_key, rails_state.data.dig(:task_corrections, 0, :id)
  ensure
    ENV["FLYD_DATABASE_URL"] = previous_url
    ENV["FLYD_DIR"] = previous_flyd_dir
    FileUtils.remove_entry(flyd_dir) if defined?(flyd_dir) && flyd_dir && File.exist?(flyd_dir)
    if defined?(task) && task
      task.task_corrections.delete_all
      task.task_artifacts.delete_all
      task.task_grants.delete_all
      task.runtime_events.delete_all
      AgentTask.where(id: task.id).delete_all
    end
    Project.where(id: project&.id).delete_all if defined?(project)
    IntelligenceSnapshot.where(provider: IntelligenceState::RuntimeTaskProvider::PROVIDER).delete_all
  end
end
