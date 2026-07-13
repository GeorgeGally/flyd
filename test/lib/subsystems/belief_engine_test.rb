require "test_helper"

class Subsystems::BeliefEngineTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Belief Test")
    @conversation = Conversation.start!(@project)
    @engine = Subsystems::BeliefEngine.new(@project)
  end

  test "synthesize creates beliefs with decision provenance" do
    d1 = @project.decisions.create!(
      conversation: @conversation,
      content: "Use PostgreSQL for primary database",
      extracted_at: Time.current
    )
    d2 = @project.decisions.create!(
      conversation: @conversation,
      content: "Use PostgreSQL for analytics",
      extracted_at: Time.current
    )

    @engine.synthesize([ d1, d2 ])
    belief = @project.beliefs.first
    assert belief.present?
    assert belief.statement.present?
    assert_equal [ d1.id, d2.id ].sort, belief.source_decision_ids.map(&:to_i).sort
  end

  test "compute_attention returns active beliefs sorted by confidence" do
    @project.beliefs.create!(statement: "Low confidence", confidence: 0.3, status: "active")
    @project.beliefs.create!(statement: "High confidence", confidence: 0.9, status: "active")
    @project.beliefs.create!(statement: "Superseded", confidence: 0.8, status: "superseded")

    beliefs = @engine.compute_attention
    assert_equal 2, beliefs.length
    assert_equal "High confidence", beliefs.first.statement
  end
end
