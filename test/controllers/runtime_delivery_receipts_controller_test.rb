require "test_helper"

class RuntimeDeliveryReceiptsControllerTest < ActionDispatch::IntegrationTest
  test "records a browser-visible runtime event idempotently" do
    project = Project.create!(name: "Receipt test", root_path: "/tmp/flyd-receipt-test")
    task = AgentTask.create!(
      project: project,
      task_key: SecureRandom.uuid,
      status: "ready",
      intended_outcome: "Measure visible delivery",
      revision: 1
    )
    event = RuntimeEvent.create!(
      agent_task: task,
      event_type: "task.oriented",
      task_revision: 1,
      occurred_at: Time.current - 0.05,
      broadcast_delivered_at: Time.current
    )
    surface = Surface.create!(status: "draft", generated_at: Time.current)
    item = surface.surface_items.create!(
      item_key: "runtime:#{task.task_key}",
      kind: "status",
      intent: "review",
      renderer: "task_review",
      depth: "foreground",
      state: "presented",
      title: "Review task",
      position: 0,
      source_refs: [ { "type" => "runtime_task", "id" => task.task_key } ],
      actions: [],
      metadata: { "task_revision" => event.task_revision }
    )
    Surface.activate!(surface)
    binding_digest = RuntimeTasks::BindingDigest.call(task: task, item: item)

    assert_difference("RuntimeDeliveryReceipt.count", 1) do
      post runtime_delivery_receipts_path, params: {
        runtime_event_id: event.id,
        client_id: "browser-test",
        surface_id: surface.id,
        binding_digest: binding_digest
      }, as: :json
    end
    assert_no_difference("RuntimeDeliveryReceipt.count") do
      post runtime_delivery_receipts_path, params: {
        runtime_event_id: event.id,
        client_id: "browser-test",
        surface_id: surface.id,
        binding_digest: binding_digest
      }, as: :json
    end

    assert_response :success
    receipt = RuntimeDeliveryReceipt.find_by!(runtime_event: event, client_id: "browser-test")
    assert_operator receipt.delivery_latency_ms, :>=, 0
    assert_equal surface.id, receipt.surface_id
    assert_equal event.task_revision, receipt.task_revision
    assert_match(/\A[0-9a-f]{64}\z/, receipt.binding_digest)
  end

  test "rejects a receipt for a different rendered task revision or digest" do
    project = Project.create!(name: "Stale receipt test", root_path: "/tmp/flyd-stale-receipt-test")
    task = AgentTask.create!(project: project, task_key: SecureRandom.uuid, status: "ready", intended_outcome: "Reject stale parity", revision: 2)
    event = RuntimeEvent.create!(agent_task: task, event_type: "task.oriented", task_revision: 2,
      occurred_at: Time.current - 0.05, broadcast_delivered_at: Time.current)
    surface = Surface.create!(status: "draft", generated_at: Time.current)
    surface.surface_items.create!(item_key: "runtime:#{task.task_key}", kind: "status", intent: "review",
      renderer: "task_review", depth: "foreground", state: "presented", title: "Stale task", position: 0,
      source_refs: [ { "type" => "runtime_task", "id" => task.task_key } ], actions: [],
      metadata: { "task_revision" => 1 })
    Surface.activate!(surface)

    post runtime_delivery_receipts_path, params: {
      runtime_event_id: event.id, client_id: "browser-test", surface_id: surface.id,
      binding_digest: Digest::SHA256.hexdigest("wrong")
    }, as: :json

    assert_response :unprocessable_entity
    assert_not RuntimeDeliveryReceipt.exists?(runtime_event: event)
  end

  test "does not acknowledge an event that was never broadcast" do
    project = Project.create!(name: "Unsent receipt test", root_path: "/tmp/flyd-unsent-receipt-test")
    task = AgentTask.create!(
      project: project,
      task_key: SecureRandom.uuid,
      status: "ready",
      intended_outcome: "Reject false visibility",
      revision: 1
    )
    event = RuntimeEvent.create!(
      agent_task: task,
      event_type: "task.oriented",
      task_revision: 1
    )

    post runtime_delivery_receipts_path, params: {
      runtime_event_id: event.id,
      client_id: "browser-test"
    }, as: :json

    assert_response :unprocessable_entity
    assert_not RuntimeDeliveryReceipt.exists?(runtime_event: event)
  end
end
