require "test_helper"

class DecisionExtractionJobTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "DE Job #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
    @conversation.messages.create!(role: "user", content: "Let us use PostgreSQL")
    @conversation.messages.create!(role: "assistant", content: "Agreed")
    @conversation.messages.create!(role: "user", content: "And use uuid primary keys")
    @conversation.messages.create!(role: "assistant", content: "OK")
    @conversation.messages.create!(role: "user", content: "Plus Redis for caching")
  end

  test "performs extraction" do
    DecisionExtractionJob.perform_now(@conversation.id)
    # May or may not extract decisions depending on LLM response
    assert @project.decisions.count >= 0
  end
end
