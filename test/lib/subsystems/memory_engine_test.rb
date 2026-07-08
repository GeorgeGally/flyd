require "test_helper"

class Subsystems::MemoryEngineTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Memory Test")
    @conversation = Conversation.start!(@project)
    @engine = Subsystems::MemoryEngine.new(@project)
  end

  test "extract_decisions creates decisions from messages" do
    skip "Requires API key" unless Flyd::KeyLoader.has_api_key?("gpt-4o-mini")

    @conversation.messages.create!(role: "user", content: "Let's use PostgreSQL")
    @conversation.messages.create!(role: "assistant", content: "Agreed, PostgreSQL is the right choice")
    @conversation.messages.create!(role: "user", content: "We'll use uuid primary keys")

    @engine.extract_decisions(@conversation, message_range: 5)
    assert @project.decisions.count >= 1
    assert @project.decisions.first.content.present?
    assert @project.decisions.first.extracted_at.present?
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
