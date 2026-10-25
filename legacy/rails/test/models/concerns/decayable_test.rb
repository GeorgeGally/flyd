require "test_helper"

class DecayableTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Decay Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
  end

  test "decision has correct half_life" do
    decision = @project.decisions.create!(conversation: @conversation, content: "test", extracted_at: Time.current)
    assert_equal 90.days, decision.half_life
  end

  test "cross_project belief has correct half_life" do
    belief = Belief.create!(statement: "test", confidence: 0.5, status: "active", project: nil)
    assert_equal 180.days, belief.half_life
  end

  test "behaviour has correct half_life" do
    behaviour = @project.behaviours.create!(name: "test", trigger_phrase: "test", description: "T", steps: [], decay_score: 1.0)
    assert_equal 365.days, behaviour.half_life
  end

  test "compute_decay_score returns 1.0 for fresh item" do
    decision = @project.decisions.create!(conversation: @conversation, content: "test", extracted_at: Time.current, last_used_at: Time.current)
    assert_in_delta 1.0, decision.compute_decay_score, 0.01
  end

  test "compute_decay_score decays over time" do
    decision = @project.decisions.create!(conversation: @conversation, content: "test", extracted_at: Time.current, last_used_at: 30.days.ago)
    score = decision.compute_decay_score
    assert score < 1.0
    assert score > 0
  end

  test "reinforce! increases score" do
    decision = @project.decisions.create!(conversation: @conversation, content: "test", extracted_at: Time.current, decay_score: 0.5, last_used_at: 1.day.ago)
    decision.reinforce!
    assert decision.decay_score > 0.5
  end

  test "reinforce! caps at 1.0" do
    decision = @project.decisions.create!(conversation: @conversation, content: "test", extracted_at: Time.current, decay_score: 0.95, last_used_at: Time.current)
    decision.reinforce!
    assert decision.decay_score <= 1.0
  end

  test "apply_decay! updates score" do
    decision = @project.decisions.create!(conversation: @conversation, content: "test", extracted_at: Time.current, decay_score: 1.0, last_used_at: 30.days.ago)
    initial = decision.decay_score
    decision.apply_decay!
    assert decision.reload.decay_score < initial
  end

  test "scope decayed returns low scoring items" do
    fresh = @project.decisions.create!(conversation: @conversation, content: "fresh", extracted_at: Time.current, decay_score: 1.0, last_used_at: Time.current)
    stale = @project.decisions.create!(conversation: @conversation, content: "stale", extracted_at: Time.current, decay_score: 0.2, last_used_at: 200.days.ago)

    decayed = @project.decisions.decayed
    assert_includes decayed, stale
    assert_not_includes decayed, fresh
  end
end
