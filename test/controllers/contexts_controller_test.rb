require "test_helper"

class ContextsControllerTest < ActionDispatch::IntegrationTest
  test "creates an interactive temporary context for an unresolved intent" do
    intent = Intent.create!(input_text: "A new temporary line of work", status: "clarification_required")

    assert_difference([ "Context.count", "ContextCorrection.count", "Conversation.count" ], 1) do
      post intent_contexts_path(intent), params: {
        context: { name: "Interface sprint", description: "A short-lived cross-project effort" }
      }
    end

    context = Context.last
    intent.reload
    assert_equal "temporary", context.kind
    assert context.expires_at.present?
    assert_equal "accepted", intent.status
    assert_equal context, intent.conversation.context
    assert_nil intent.conversation.project
    assert_equal "context", intent.resolved_contexts.first["type"]
    assert_equal context.id.to_s, intent.resolved_contexts.first["id"].to_s
  end
end
