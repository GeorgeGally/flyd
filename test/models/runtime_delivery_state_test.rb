require "test_helper"

class RuntimeDeliveryStateTest < ActiveSupport::TestCase
  test "reports whether a leased cursor covers a task" do
    project = Project.create!(name: "Delivery state #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Deliver runtime changes")
    event = task.runtime_events.create!(event_type: "task.created", task_revision: 0)
    state = RuntimeDeliveryState.create!(
      listener_key: "primary",
      last_event_id: event.id,
      lease_owner: "listener-1",
      lease_expires_at: 1.minute.from_now
    )

    assert state.covers?(task)
    state.last_event_id = event.id - 1
    assert_not state.covers?(task)
  end
end
