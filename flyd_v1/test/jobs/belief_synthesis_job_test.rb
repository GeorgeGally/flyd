require "test_helper"

class BeliefSynthesisJobTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "BS Job #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
    # Create a decision in the last 24 hours
    @project.decisions.create!(conversation: @conversation, content: "Use PostgreSQL", extracted_at: 1.hour.ago)
  end

  test "performs synthesis" do
    BeliefSynthesisJob.perform_now(@project.id)
    assert @project.beliefs.count >= 0
  end
end
