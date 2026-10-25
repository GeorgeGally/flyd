require "test_helper"

class BroadcastRuntimeObservationJobTest < ActiveJob::TestCase
  test "broadcasts a current bound task without changing its semantic revision" do
    project = Project.create!(name: "Observe runtime #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Show current activity")
    surface = Surface.create!(
      status: "draft",
      understanding: "Working",
      current_intention: "Monitor",
      generated_at: Time.current
    )
    item = surface.surface_items.create!(
      item_key: "runtime:observation",
      kind: "status",
      intent: "monitor",
      renderer: "worker_monitor",
      depth: "foreground",
      state: "presented",
      title: "Working",
      summary: "One task",
      position: 0,
      source_refs: [ { "type" => "runtime_task", "id" => task.task_key } ],
      metadata: { "task_revision" => task.revision }
    )
    Surface.activate!(surface)
    calls = []

    Turbo::StreamsChannel.stub(:broadcast_replace_to, ->(*args, **kwargs) { calls << [ args, kwargs ] }) do
      BroadcastRuntimeObservationJob.perform_now(task.task_key, task.revision)
    end

    assert_equal 1, calls.length
    assert_equal 0, item.reload.metadata["task_revision"]
  end
end
