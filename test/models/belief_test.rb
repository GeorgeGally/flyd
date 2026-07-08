require "test_helper"

class BeliefTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Belief Model Test #{Time.now.to_i}")
  end

  test "creates active belief" do
    belief = @project.beliefs.create!(
      statement: "Team prefers PostgreSQL",
      confidence: 0.7,
      status: "active"
    )
    assert_equal "active", belief.status
    assert_in_delta 0.7, belief.confidence
  end

  test "scope active returns only active beliefs" do
    @project.beliefs.create!(statement: "Active", confidence: 0.5, status: "active")
    @project.beliefs.create!(statement: "Challenged", confidence: 0.5, status: "challenged")
    @project.beliefs.create!(statement: "Superseded", confidence: 0.5, status: "superseded")

    assert_equal 1, @project.beliefs.active.count
  end

  test "cross_project scope returns beliefs without project" do
    project_belief = @project.beliefs.create!(statement: "Project", confidence: 0.5, status: "active")
    cross_belief = Belief.create!(statement: "Cross", confidence: 0.5, status: "active", project: nil)

    assert_includes Belief.cross_project, cross_belief
    assert_not_includes Belief.cross_project, project_belief
  end

  test "challenge! sets status to challenged" do
    belief = @project.beliefs.create!(statement: "Test", confidence: 0.5, status: "active")
    belief.challenge!
    assert_equal "challenged", belief.reload.status
  end

  test "supersede! sets status to superseded" do
    belief = @project.beliefs.create!(statement: "Test", confidence: 0.5, status: "active")
    belief.supersede!
    assert_equal "superseded", belief.reload.status
  end

  test "decay_type returns project_decision when project present" do
    belief = @project.beliefs.create!(statement: "Test", confidence: 0.5, status: "active")
    assert_equal :project_decision, belief.decay_type
  end

  test "decay_type returns cross_project_belief when project nil" do
    belief = Belief.create!(statement: "Test", confidence: 0.5, status: "active", project: nil)
    assert_equal :cross_project_belief, belief.decay_type
  end
end
