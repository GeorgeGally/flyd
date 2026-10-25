require "test_helper"

class BehaviourTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Behaviour Model Test #{Time.now.to_i}")
  end

  test "creates with trigger phrase" do
    behaviour = @project.behaviours.create!(
      name: "DB setup",
      trigger_phrase: "database configuration",
      description: "Steps for setting up a database",
      steps: [ { step: 1, action: "choose database" } ],
      decay_score: 1.0
    )
    assert_equal "database configuration", behaviour.trigger_phrase
    assert_equal 1, behaviour.steps.length
  end

  test "matching_trigger? checks all words" do
    behaviour = @project.behaviours.create!(
      name: "DB setup",
      trigger_phrase: "database configuration",
      description: "Test",
      steps: [],
      decay_score: 1.0
    )
    assert behaviour.matching_trigger?("we need database configuration")
    assert_not behaviour.matching_trigger?("just database stuff")
  end

  test "success_rate calculates correctly" do
    behaviour = @project.behaviours.create!(
      name: "Test", trigger_phrase: "test", description: "T", steps: [],
      success_count: 3, failure_count: 1, decay_score: 1.0
    )
    assert_in_delta 0.75, behaviour.success_rate
  end

  test "success_rate returns 0 when no records" do
    behaviour = @project.behaviours.create!(
      name: "Test", trigger_phrase: "test", description: "T", steps: [],
      success_count: 0, failure_count: 0, decay_score: 1.0
    )
    assert_equal 0, behaviour.success_rate
  end

  test "record_success! increments count and reinforces" do
    behaviour = @project.behaviours.create!(
      name: "Test", trigger_phrase: "test", description: "T", steps: [],
      success_count: 0, failure_count: 0, decay_score: 0.5, last_used_at: 1.day.ago
    )
    behaviour.record_success!
    behaviour.reload
    assert_equal 1, behaviour.success_count
    assert behaviour.decay_score > 0.5
  end

  test "record_failure! increments count" do
    behaviour = @project.behaviours.create!(
      name: "Test", trigger_phrase: "test", description: "T", steps: [],
      success_count: 0, failure_count: 0, decay_score: 0.5
    )
    behaviour.record_failure!
    behaviour.reload
    assert_equal 1, behaviour.failure_count
  end

  test "decay_type returns behaviour" do
    behaviour = @project.behaviours.create!(
      name: "Test", trigger_phrase: "test", description: "T", steps: [], decay_score: 1.0
    )
    assert_equal :behaviour, behaviour.decay_type
  end
end
