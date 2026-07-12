require "test_helper"

class InterpretIntentJobTest < ActiveJob::TestCase
  test "keeps ambiguous intents unresolved without creating a project" do
    intent = Intent.create!(input_text: "Something is off across everything")
    resolution = ContextResolver::Result.new(project: nil, confidence: 0.2, reason: "Ambiguous", requires_confirmation: true)

    ContextResolver.stub(:call, resolution) do
      InterpretIntentJob.perform_now(intent.id)
    end

    assert_equal "clarification_required", intent.reload.status
    assert_empty intent.resolved_contexts
    assert_nil intent.conversation
    assert_not Project.exists?(name: "Inbox")
  end

  test "accepts a confident project context and starts the conversation" do
    project = Project.create!(name: "Flyd")
    intent = Intent.create!(input_text: "Fix the Flyd surface")
    resolution = ContextResolver::Result.new(project: project, confidence: 0.95, reason: "Direct match", requires_confirmation: false)

    ContextResolver.stub(:call, resolution) do
      assert_enqueued_with(job: LlmStreamingJob) do
        InterpretIntentJob.perform_now(intent.id)
      end
    end

    intent.reload
    assert_equal "accepted", intent.status
    assert_equal project.id, intent.resolved_contexts.first["id"]
    assert_equal intent.input_text, intent.conversation.messages.last.content
  end
end
