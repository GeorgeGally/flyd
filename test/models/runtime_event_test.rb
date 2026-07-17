require "test_helper"

class RuntimeEventTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Runtime event #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Record events")
  end

  test "idempotency keys are globally unique" do
    @task.runtime_events.create!(event_type: "task.created", task_revision: 0, idempotency_key: "create:one")

    duplicate = @task.runtime_events.new(event_type: "task.created", task_revision: 1, idempotency_key: "create:one")

    assert_not duplicate.valid?
    assert_includes duplicate.errors[:idempotency_key], "has already been taken"
  end

  test "event revisions are unique within a task" do
    @task.runtime_events.create!(event_type: "task.created", task_revision: 0)

    duplicate = @task.runtime_events.new(event_type: "task.oriented", task_revision: 0)

    assert_not duplicate.valid?
  end
end
