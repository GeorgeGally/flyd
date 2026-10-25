require "test_helper"

class BroadcastRuntimeTaskJobTest < ActiveJob::TestCase
  test "rebinds and broadcasts the current task scene" do
    project = Project.create!(name: "Broadcast runtime #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Broadcast runtime")
    event = task.runtime_events.create!(event_type: "task.oriented", task_revision: 1)
    AgentTask.where(id: task.id).update_all(revision: 1)
    scene = Scene.create!(scene_key: "runtime:broadcast", kind: "monitoring", status: "active", title: "Working", project: project)
    surface = Surface.create!(
      status: "draft",
      understanding: "Working",
      current_intention: "Monitor",
      focus_item_key: scene.scene_key,
      generated_at: Time.current,
      metadata: { "surface_mode" => "monitoring" }
    )
    item = surface.surface_items.create!(
      scene: scene,
      item_key: scene.scene_key,
      kind: "status",
      intent: "monitor",
      renderer: "worker_monitor",
      depth: "foreground",
      state: "presented",
      title: "Working",
      summary: "One task",
      position: 0,
      source_refs: [ { "type" => "runtime_task", "id" => task.task_key } ],
      metadata: { "task_revision" => 0 }
    )
    Surface.activate!(surface)
    delivery = RuntimeDeliveryState.create!(
      listener_key: AgentRuntime::EventListener::LISTENER_KEY,
      last_event_id: event.id,
      lease_owner: "test-listener",
      lease_expires_at: 1.minute.from_now
    )
    calls = []

    Turbo::StreamsChannel.stub(:broadcast_replace_to, ->(*args, **kwargs) { calls << [ args, kwargs ] }) do
      BroadcastRuntimeTaskJob.perform_now(event.id)
    end

    assert_equal 0, item.reload.metadata["task_revision"]
    assert_equal 1, calls.length
    assert_equal event, calls.first.last.dig(:locals, :runtime_event)
    assert event.reload.broadcast_delivered_at
    assert delivery.reload.last_delivered_at
    assert_operator delivery.delivery_latency_ms, :>=, 0
  end
end
