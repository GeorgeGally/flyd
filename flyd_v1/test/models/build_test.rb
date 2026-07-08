require "test_helper"

class BuildTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Build Model Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
  end

  test "creates with pending status" do
    build = @project.builds.create!(conversation: @conversation, status: "pending")
    assert_equal "pending", build.status
  end

  test "status lifecycle transitions" do
    build = @project.builds.create!(conversation: @conversation, status: "pending")
    build.start!
    assert_equal "preparing", build.reload.status
    build.complete!(output: "done", summary: "Built")
    assert_equal "complete", build.reload.status
  end

  test "fail! sets status and reason" do
    build = @project.builds.create!(conversation: @conversation, status: "pending")
    build.fail!(reason: "Error")
    assert_equal "failed", build.reload.status
    assert_equal "Error", build.outcome_summary
  end
end
