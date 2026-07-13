require "test_helper"

class ContextCorrectionsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  test "accepts no persistent context without creating an Inbox project" do
    intent = Intent.create!(input_text: "A global thought", status: "clarification_required")

    assert_difference("ContextCorrection.count", 1) do
      post intent_context_corrections_path(intent), params: { reason: "No persistent context" }
    end

    assert_redirected_to root_path(intent_id: intent.id)
    assert_equal "accepted", intent.reload.status
    assert_empty intent.resolved_contexts
    assert_not Project.exists?(name: "Inbox")
  end

  test "corrected project context supersedes the incorrectly routed conversation" do
    wrong_project = Project.create!(name: "Wrong")
    correct_project = Project.create!(name: "Flyd")
    old_conversation = Conversation.start!(wrong_project)
    old_conversation.messages.create!(role: "user", content: "Fix this")
    intent = Intent.create!(input_text: "Fix this", status: "accepted", conversation: old_conversation)

    post intent_context_corrections_path(intent), params: {
      corrected_contexts: [{ type: "project", id: correct_project.id, name: correct_project.name }]
    }

    intent.reload
    assert_equal correct_project, intent.conversation.project
    assert_equal "Fix this", intent.conversation.messages.last.content
    assert_equal "superseded", old_conversation.reload.status
    assert_equal intent.conversation, old_conversation.superseded_by_conversation
    assert_equal correct_project.id.to_s, intent.resolved_contexts.first["id"].to_s
  end

  test "corrected temporary context starts a non-project conversation" do
    context = Context.create!(name: "Interface sprint")
    intent = Intent.create!(input_text: "Continue this", status: "clarification_required")

    post intent_context_corrections_path(intent), params: {
      corrected_contexts: [{ type: "context", id: context.id, name: context.name }]
    }

    assert_equal context, intent.reload.conversation.context
    assert_nil intent.conversation.project
  end

  test "rejects fabricated context references" do
    intent = Intent.create!(input_text: "Fix this", status: "clarification_required")

    assert_no_difference("ContextCorrection.count") do
      post intent_context_corrections_path(intent), params: {
        corrected_contexts: [{ type: "project", id: 999_999, name: "Imaginary" }]
      }
    end

    assert_redirected_to root_path(intent_id: intent.id)
    assert_equal "clarification_required", intent.reload.status
  end
end
