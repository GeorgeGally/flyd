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

    @engine.stub(:extract_topic, "postgresql") do
      @engine.synthesize([ d1, d2 ])
    end
    belief = @project.beliefs.first
    assert belief.present?
    assert belief.statement.present?
    assert_equal [ d1.id, d2.id ].sort, belief.source_decision_ids.map(&:to_i).sort
  end

  test "synthesize creates derived_from memory edges between decisions and belief" do
    d1 = @project.decisions.create!(
      conversation: @conversation,
      content: "Use Redis for caching",
      extracted_at: Time.current
    )
    d2 = @project.decisions.create!(
      conversation: @conversation,
      content: "Redis with cluster mode",
      extracted_at: Time.current
    )

    @engine.stub(:extract_topic, "redis") do
      @engine.synthesize([ d1, d2 ])
    end
    belief = @project.beliefs.first
    edges = MemoryEdge.where(target: belief, relationship_type: "derived_from")
    assert_equal 2, edges.count
    assert_equal [ d1.id, d2.id ].sort, edges.map(&:source_id).sort
  end

  test "idempotent edge creation does not duplicate on re-synthesis" do
    d1 = @project.decisions.create!(
      conversation: @conversation,
      content: "Use Sidekiq for jobs",
      extracted_at: Time.current
    )

    @engine.stub(:extract_topic, "sidekiq") do
      2.times { @engine.synthesize([ d1 ]) }
    end
    belief = @project.beliefs.first
    edges = MemoryEdge.where(target: belief, relationship_type: "derived_from")
    assert_equal 1, edges.count
  end

  test "detect_contradictions creates contradicts edges" do
    belief = @project.beliefs.create!(
      statement: "We use PostgreSQL",
      confidence: 0.9,
      status: "active"
    )
    decision = @project.decisions.create!(
      conversation: @conversation,
      content: "Switch to MySQL for all databases",
      extracted_at: Time.current
    )

    @engine.stub(:potentially_contradicts?, true) do
      @engine.detect_contradictions(decision)
    end

    assert_equal "challenged", belief.reload.status
    edge = MemoryEdge.find_by(
      source: decision,
      target: belief,
      relationship_type: "contradicts"
    )
     assert edge.present?
    assert_equal 0.8, edge.confidence
  end
end
