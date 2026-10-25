require "test_helper"

class TaskAssignmentTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Assignment #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Coordinate bounded work")
  end

  test "persists a bounded assignment as a read-only projection" do
    assignment = @task.task_assignments.create!(
      title: "Implement adapter",
      instructions: "Add the provider-neutral adapter",
      success_criteria: [ "Adapter contract tests pass" ],
      capability_requirements: [ "implementation", "testing" ],
      declared_file_scope: [ "cli/src/runtime" ],
      base_head: "abc123"
    )

    assert assignment.assignment_key.present?
    assert_equal 1, assignment.revision
    assert_raises(ActiveRecord::ReadOnlyRecord) { assignment.update!(status: "running") }
  end

  test "dependency keys must be distinct strings and cannot include self" do
    assignment = @task.task_assignments.new(
      assignment_key: "assignment-a",
      title: "Review",
      instructions: "Review the implementation",
      dependency_keys: [ "assignment-a", "assignment-b", "assignment-b", 7 ]
    )

    assert_not assignment.valid?
    assert_includes assignment.errors[:dependency_keys], "must contain distinct assignment keys other than itself"
  end

  test "revision must be positive" do
    assignment = @task.task_assignments.new(
      title: "Review",
      instructions: "Review the implementation",
      revision: 0
    )

    assert_not assignment.valid?
    assert_includes assignment.errors[:revision], "must be greater than 0"
  end
end
