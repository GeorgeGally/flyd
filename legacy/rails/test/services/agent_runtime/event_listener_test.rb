require "test_helper"

class AgentRuntime::EventListenerTest < ActiveSupport::TestCase
  FakeJob = Struct.new(:calls) do
    def perform_later(*arguments)
      calls << arguments
    end
  end
  HealthyBridge = Struct.new(:calls) do
    def call(request)
      calls << request
      { "action" => "health", "data" => { "healthy" => true } }
    end
  end
  FailingBridge = Struct.new(:message) do
    def call(_request)
      raise AgentRuntime::Bridge::Error, message
    end
  end

  test "replays committed events in order and advances the durable cursor" do
    project = Project.create!(name: "Listener #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Replay events")
    first = task.runtime_events.create!(event_type: "task.created", task_revision: 0, occurred_at: 2.seconds.ago)
    second = task.runtime_events.create!(event_type: "task.oriented", task_revision: 1, occurred_at: 1.second.ago)
    broadcast = FakeJob.new([])
    recompose = FakeJob.new([])
    bridge = HealthyBridge.new([])
    listener = AgentRuntime::EventListener.new(
      owner: "listener-test",
      broadcast_job: broadcast,
      recompose_job: recompose,
      runtime_bridge: bridge
    )

    assert_equal 2, listener.deliver_pending
    assert_equal [ [ first.id ], [ second.id ] ], broadcast.calls
    assert_equal [ [ task.id, 0 ], [ task.id, 1 ] ], recompose.calls
    state = RuntimeDeliveryState.find_by!(listener_key: "primary")
    assert_equal second.id, state.last_event_id
    assert state.lease_active?
    assert_nil state.delivery_latency_ms

    assert_equal 0, listener.deliver_pending
    assert_equal 2, broadcast.calls.length
    assert_equal 2, bridge.calls.length
  end

  test "does not advance the cursor when dispatch fails" do
    project = Project.create!(name: "Listener fail #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Retry delivery")
    task.runtime_events.create!(event_type: "task.created", task_revision: 0)
    failing = Object.new
    def failing.perform_later(*) = raise("queue unavailable")
    listener = AgentRuntime::EventListener.new(
      owner: "listener-test",
      broadcast_job: failing,
      runtime_bridge: HealthyBridge.new([])
    )

    assert_raises(RuntimeError) { listener.deliver_pending }
    state = RuntimeDeliveryState.find_by!(listener_key: "primary")
    assert_equal 0, state.last_event_id
    assert_match(/queue unavailable/, state.last_error)
  end

  test "delivers persisted worker observations without creating a semantic event" do
    observations = FakeJob.new([])
    listener = AgentRuntime::EventListener.new(
      owner: "listener-test",
      observation_job: observations,
      runtime_bridge: HealthyBridge.new([])
    )

    delivered = listener.deliver_notification(
      JSON.generate(event_type: "worker.observed", task_key: "task-1", task_revision: 7)
    )

    assert delivered
    assert_equal [ [ "task-1", 7 ] ], observations.calls
    assert_not listener.deliver_notification("not json")
  end

  test "records runtime bridge failure and leaves delivery unhealthy" do
    project = Project.create!(name: "Listener health #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Fail closed")
    listener = AgentRuntime::EventListener.new(
      owner: "listener-test",
      runtime_bridge: FailingBridge.new("bridge unavailable")
    )

    assert_raises(AgentRuntime::Bridge::Error) { listener.deliver_pending }
    state = RuntimeDeliveryState.find_by!(listener_key: "primary")
    assert_match(/bridge unavailable/, state.last_error)
    assert_not state.covers?(task)
  end
end
