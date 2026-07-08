require "test_helper"

class DecisionTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Decision Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
  end

  test "creates a valid decision" do
    decision = @project.decisions.create!(
      conversation: @conversation,
      content: "Use PostgreSQL",
      extracted_at: Time.current,
      confidence: 0.8
    )
    assert_equal "Use PostgreSQL", decision.content
    assert_in_delta 0.8, decision.confidence
    assert_equal :project_decision, decision.decay_type
  end

  test "syncs project from conversation on create" do
    decision = @conversation.decisions.create!(
      content: "Use Redis",
      extracted_at: Time.current
    )
    assert_equal @project.id, decision.project_id
  end

  test "decay_type returns project_decision" do
    decision = @project.decisions.create!(
      conversation: @conversation,
      content: "test",
      extracted_at: Time.current
    )
    assert_equal :project_decision, decision.decay_type
  end

  test "scope by_recency orders correctly" do
    old = @project.decisions.create!(conversation: @conversation, content: "old", extracted_at: 2.days.ago)
    new = @project.decisions.create!(conversation: @conversation, content: "new", extracted_at: 1.hour.ago)

    assert_equal [new, old], @project.decisions.by_recency.to_a
  end
end
