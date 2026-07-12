require "test_helper"

class ContextCorrectionsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  test "accepts no-project context without creating an Inbox project" do
    intent = Intent.create!(input_text: "A global thought", status: "clarification_required")

    assert_difference("ContextCorrection.count", 1) do
      post intent_context_corrections_path(intent), params: { reason: "No project context" }
    end

    assert_redirected_to root_path(intent_id: intent.id)
    assert_equal "accepted", intent.reload.status
    assert_empty intent.resolved_contexts
    assert_not Project.exists?(name: "Inbox")
  end

  test "corrected project context starts the intended conversation" do
    project = Project.create!(name: "Flyd")
    intent = Intent.create!(input_text: "Fix this", status: "clarification_required")

    post intent_context_corrections_path(intent), params: {
      corrected_contexts: [{ type: "project", id: project.id, name: project.name }]
    }

    intent.reload
    assert_equal project, intent.conversation.project
    assert_equal "Fix this", intent.conversation.messages.last.content
    assert_equal project.id.to_s, intent.resolved_contexts.first["id"].to_s
  end
end
