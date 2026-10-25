require "test_helper"

class ReleaseAcceptance::EvidenceTest < ActiveSupport::TestCase
  test "counts only sessions with a worker-produced verified artifact and visible client state" do
    marker = ReleaseMarker.find_or_create_by!(release_key: "release_1c") do |release|
      release.available_at = 1.day.ago
    end
    marker.update!(available_at: 1.day.ago)

    project = Project.create!(
      name: "Acceptance evidence #{SecureRandom.hex(4)}",
      root_path: "/tmp/acceptance-#{SecureRandom.hex(4)}"
    )
    task = project.agent_tasks.create!(intended_outcome: "Produce real acceptance evidence")
    assignment = task.task_assignments.create!(title: "Implement", instructions: "Implement and verify")
    grant = task.task_grants.create!(
      status: "approved",
      approved_at: Time.current,
      repository_roots: [ project.root_path ],
      worktree_paths: [ project.root_path ],
      worker_adapters: [ "codex" ],
      verification_commands: [ "bin/rails test" ],
      expires_at: 8.hours.from_now
    )

    started_at = 2.hours.ago
    ended_at = 1.hour.ago
    real_session = task.task_sessions.create!(
      status: "ended",
      resumed: true,
      interpretation_status: "focused_corrected",
      started_at:,
      ended_at:
    )
    task.task_recommendations.create!(
      task_session: real_session,
      release_key: marker.release_key,
      task_revision: task.revision,
      action: "Review the verified implementation",
      action_digest: Digest::SHA256.hexdigest("Review the verified implementation"),
      disposition: "adapted",
      acted_at: ended_at
    )
    undelivered_surface = Surface.create!(status: "draft", generated_at: Time.current)
    undelivered_item = undelivered_surface.surface_items.create!(
      item_key: "runtime:undelivered", kind: "status", intent: "review",
      renderer: "task_review", depth: "foreground", state: "presented",
      title: "Undelivered recommendation", position: 0
    )
    task.task_recommendations.create!(
      surface_item: undelivered_item,
      release_key: marker.release_key,
      task_revision: task.revision,
      action: "This was composed but never reached a browser",
      action_digest: Digest::SHA256.hexdigest("undelivered recommendation")
    )
    worker = task.worker_sessions.create!(
      task_assignment: assignment,
      task_grant: grant,
      status: "completed",
      adapter: "codex",
      working_directory: project.root_path,
      started_at: started_at + 10.minutes,
      ended_at: started_at + 30.minutes,
      exit_status: 0
    )
    artifact = task.task_artifacts.create!(
      task_assignment: assignment,
      worker_session: worker,
      kind: "test",
      title: "Verified acceptance test",
      media_type: "text/plain",
      byte_size: 6,
      sha256_digest: Digest::SHA256.hexdigest("passed"),
      verification_status: "verified",
      source_revision: task.revision,
      content: "passed",
      created_at: started_at + 40.minutes,
      updated_at: started_at + 40.minutes
    )

    event = task.runtime_events.create!(
      event_type: "worker.completed",
      task_revision: task.revision + 1,
      occurred_at: started_at + 45.minutes,
      broadcast_delivered_at: started_at + 46.minutes
    )
    AgentTask.where(id: task.id).update_all(revision: task.revision + 1)
    task.reload
    delivered_surface = Surface.create!(status: "draft", generated_at: Time.current)
    delivered_item = delivered_surface.surface_items.create!(
      item_key: "runtime:#{task.task_key}", kind: "status", intent: "review",
      renderer: "task_review", depth: "foreground", state: "presented",
      title: "Visible runtime state", position: 0,
      source_refs: [ { "type" => "runtime_task", "id" => task.task_key } ],
      actions: [], metadata: { "task_revision" => event.task_revision }
    )
    Surface.activate!(delivered_surface)
    event.runtime_delivery_receipts.create!(
      client_id: "acceptance-browser",
      surface_id: delivered_surface.id,
      surface_item: delivered_item,
      acknowledged_at: event.occurred_at + 0.5.seconds,
      delivery_latency_ms: 500,
      task_revision: event.task_revision,
      binding_digest: RuntimeTasks::BindingDigest.call(task: task, item: delivered_item)
    )
    ReleaseAcceptanceObservation.create!(
      kind: "memory_safety",
      passed: true,
      evidence: { "note" => "Sample passed" },
      idempotency_key: SecureRandom.uuid,
      observed_at: 30.minutes.ago
    )
    ReleaseAcceptanceObservation.create!(
      kind: "automated_acceptance",
      passed: true,
      evidence: {
        "idempotent" => true,
        "permissions_enforced" => true,
        "no_duplicate_effects" => true
      },
      idempotency_key: SecureRandom.uuid,
      observed_at: 30.minutes.ago
    )

    task.task_sessions.create!(
      status: "ended",
      resumed: true,
      interpretation_status: "accepted",
      started_at: 50.minutes.ago,
      ended_at: 40.minutes.ago
    )

    evidence = ReleaseAcceptance::Evidence.call

    assert_equal 1, evidence[:real_sessions]
    assert_equal 1, evidence[:resumed_sessions]
    assert_equal 1, evidence[:recommended_actions]
    assert_equal 1, evidence[:accepted_or_adapted_actions]
    assert_equal 1, evidence[:parity_evidence_count]
    assert_equal [ 500 ], evidence[:propagation_latencies_ms]
    assert_equal [ true ], evidence[:memory_safety_reviews]
    assert_equal true, evidence.dig(:automated_acceptance_runs, 0, :idempotent)
    assert_equal [ real_session.started_at.in_time_zone.to_date.to_s ], evidence[:real_session_dates]
  end
end
