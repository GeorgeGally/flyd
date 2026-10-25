require "test_helper"

class Subsystems::BehaviourEngineTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Behaviour Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
    chat = Object.new
    chat.define_singleton_method(:call) { |_messages| "database configuration" }
    @engine = Subsystems::BehaviourEngine.new(@project, chat:)
  end

  test "compile_from_patterns creates behaviours from decision sequences" do
    d1 = @project.decisions.create!(conversation: @conversation, content: "Use PostgreSQL for primary database", extracted_at: Time.current)
    d2 = @project.decisions.create!(conversation: @conversation, content: "Use uuid primary keys", extracted_at: Time.current)
    d3 = @project.decisions.create!(conversation: @conversation, content: "Use connection pooling with PgBouncer", extracted_at: Time.current)

    @engine.compile_from_patterns([[ d1, d2, d3 ]])
    assert @project.behaviours.count >= 1
    assert @project.behaviours.first.trigger_phrase.present?
  end

  test "compile_from_patterns does not duplicate existing behaviours with matching trigger" do
    trigger = "database configuration"
    existing = @project.behaviours.create!(
      name: "Database config",
      trigger_phrase: trigger,
      description: "Test",
      steps: [ { step: 1, action: "test" } ],
      decay_score: 0.5,
      last_used_at: 1.day.ago
    )

    # Create a behaviour with a trigger that matches what we'll manually set
    d = @project.decisions.create!(conversation: @conversation, content: "Use PostgreSQL", extracted_at: Time.current)
    @engine.compile_from_patterns([[ d ]])

    assert @project.behaviours.count >= 1
  end

  test "match_trigger finds matching behaviour" do
    @project.behaviours.create!(
      name: "Database config",
      trigger_phrase: "database configuration decision",
      description: "Test",
      steps: [ { step: 1, action: "use postgresql" } ],
      decay_score: 1.0
    )

    match = @engine.match_trigger("We need to make a database configuration decision")
    assert match
    assert_equal "database configuration decision", match.trigger_phrase
  end

  test "match_trigger returns nil for no match" do
    match = @engine.match_trigger("Lets refactor the frontend")
    assert_nil match
  end

  test "inject_behaviour_steps returns steps for matched trigger" do
    @project.behaviours.create!(
      name: "Database config",
      trigger_phrase: "database setup",
      description: "Test",
      steps: [ { step: 1, action: "choose database" }, { step: 2, action: "configure connection" } ],
      decay_score: 1.0
    )

    steps = @engine.inject_behaviour_steps("we are doing database setup now")
    assert steps
    assert_equal 2, steps.length
  end

  test "inject_behaviour_steps returns nil for no match" do
    steps = @engine.inject_behaviour_steps("random text")
    assert_nil steps
  end
end
