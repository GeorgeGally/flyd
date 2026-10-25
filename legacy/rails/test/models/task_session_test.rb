require "test_helper"

class TaskSessionTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Task session #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Measure continuity")
  end

  test "Rails treats persisted task sessions as read-only projections" do
    session = @task.task_sessions.create!(resumed: true, started_at: Time.current)

    assert_raises(ActiveRecord::ReadOnlyRecord) { session.update!(status: "ended") }
  end
end
