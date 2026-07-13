require "test_helper"

class LlmStreamingJobTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Stream Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
  end

  test "system_prompt includes project context when decisions exist" do
    user_message = @conversation.messages.create!(role: "user", content: "Use Redis for caching")
    @conversation.messages.create!(role: "assistant", content: "Good choice")

    @project.decisions.create!(
      conversation: @conversation,
      source_message: user_message,
      content: "Using Redis for caching",
      extracted_at: Time.current
    )

    prompt = LlmStreamingJob.new.send(:system_prompt, @conversation, @conversation.visible_messages)
    assert_includes prompt, "Redis"
    assert_includes prompt, "Project Context"
  end

  test "system_prompt is unchanged when no decisions or beliefs exist" do
    @conversation.messages.create!(role: "user", content: "Hello")
    prompt = LlmStreamingJob.new.send(:system_prompt, @conversation, @conversation.visible_messages)
    assert_includes prompt, "Flyd"
    assert_includes prompt, @project.name
  end

  test "system_prompt includes behaviour steps when matched" do
    @conversation.messages.create!(role: "user", content: "Lets make a database configuration decision")
    @conversation.messages.create!(role: "assistant", content: "OK")

    @project.behaviours.create!(
      name: "Database config",
      trigger_phrase: "database configuration decision",
      description: "Test",
      steps: [ { step: 1, action: "choose database" } ],
      decay_score: 1.0
    )

    prompt = LlmStreamingJob.new.send(:system_prompt, @conversation, @conversation.visible_messages)
    assert_includes prompt, "Detected Behaviour Pattern"
  end
end
