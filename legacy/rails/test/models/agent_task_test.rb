require "test_helper"

class AgentTaskTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Agent task #{SecureRandom.hex(4)}", root_path: Dir.home)
  end

  test "only one unfinished task may own a project" do
    @project.agent_tasks.create!(intended_outcome: "First outcome")

    duplicate = @project.agent_tasks.new(intended_outcome: "Second outcome")

    assert_not duplicate.valid?
    assert_includes duplicate.errors[:project_id], "already has unfinished work"
  end

  test "Rails treats persisted runtime tasks as read-only projections" do
    task = @project.agent_tasks.create!(intended_outcome: "Ship continuity")

    assert_raises(ActiveRecord::ReadOnlyRecord) { task.update!(status: "completed") }
  end
end
