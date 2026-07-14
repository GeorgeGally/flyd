require "test_helper"

class Subsystems::MemoryEngineTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Memory Test")
    @conversation = Conversation.start!(@project)
    @engine = Subsystems::MemoryEngine.new(@project)
  end

  test "extract_decisions creates decisions from messages" do
    first_source = @conversation.messages.create!(role: "user", content: "Let's use PostgreSQL")
    @conversation.messages.create!(role: "assistant", content: "Agreed, PostgreSQL is the right choice")
    source_message = @conversation.messages.create!(role: "user", content: "We'll use uuid primary keys")

    responses = [
      '[{"content":"Use PostgreSQL"}]',
      '[{"content":"Use UUID primary keys"}]'
    ]
    @engine.stub(:call_llm, ->(*) { responses.shift }) do
      @engine.extract_decisions(@conversation, message_range: 5)
    end

    assert_equal 2, @project.decisions.count
    assert_equal first_source, @project.decisions.find_by!(content: "Use PostgreSQL").source_message
    uuid_decision = @project.decisions.find_by!(content: "Use UUID primary keys")
    assert_equal source_message, uuid_decision.source_message
    assert uuid_decision.extracted_at.present?
  end

  test "extract_decisions ignores superseded message segments" do
    superseded = @conversation.messages.create!(
      role: "user",
      content: "Use the wrong database",
      metadata: { "context_superseded" => true }
    )
    @conversation.messages.create!(
      role: "assistant",
      content: "Wrong response",
      metadata: { "context_superseded" => true }
    )
    current = @conversation.messages.create!(role: "user", content: "Use PostgreSQL")

    @engine.stub(:call_llm, '[{"content":"Use PostgreSQL"}]') do
      @engine.extract_decisions(@conversation)
    end

    decision = @project.decisions.last
    assert_equal current, decision.source_message
    assert_not_equal superseded, decision.source_message
  end

  test "relevant_context formats project decisions" do
    @project.decisions.create!(
      conversation: @conversation,
      content: "Using PostgreSQL for primary database",
      extracted_at: Time.current
    )

    context = @engine.relevant_context(@conversation)
    assert_match "PostgreSQL", context
    assert_match "Project Context", context
  end

  test "relevant_context returns empty string for no items" do
    context = @engine.relevant_context(@conversation)
    assert_equal "", context
  end

  test "inject_context_into_prompt prepends context" do
    @project.decisions.create!(
      conversation: @conversation,
      content: "Using Redis for caching",
      extracted_at: Time.current
    )

    result = @engine.inject_context_into_prompt("Hello world")
    assert_match "Redis", result
    assert_match "Hello world", result
  end

  test "inject_context_into_prompt returns original when no context" do
    result = @engine.inject_context_into_prompt("Hello world")
    assert_equal "Hello world", result
  end
end
