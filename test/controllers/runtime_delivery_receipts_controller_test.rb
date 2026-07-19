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

    assert_difference("RuntimeDeliveryReceipt.count", 1) do
      post runtime_delivery_receipts_path, params: {
        runtime_event_id: event.id,
        client_id: "browser-test",
        surface_id: 7
      }, as: :json
    end
    assert_no_difference("RuntimeDeliveryReceipt.count") do
      post runtime_delivery_receipts_path, params: {
        runtime_event_id: event.id,
        client_id: "browser-test",
        surface_id: 7
      }, as: :json
    end

    assert_response :success
    receipt = RuntimeDeliveryReceipt.find_by!(runtime_event: event, client_id: "browser-test")
    assert_operator receipt.delivery_latency_ms, :>=, 0
    assert_equal 7, receipt.surface_id
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
