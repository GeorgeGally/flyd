require "test_helper"

class IntentsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    Surface.fallback!
  end

  test "persists raw intent before context exists" do
    assert_difference("Intent.count", 1) do
      assert_enqueued_with(job: InterpretIntentJob) do
        post intents_path, params: { intent: { text: "This might affect several projects", modality: "text" } }
      end
    end

    intent = Intent.order(:created_at).last
    assert_equal "received", intent.status
    assert_empty intent.resolved_contexts
    assert_nil intent.conversation
    assert_redirected_to root_path(intent_id: intent.id)
    assert_not Project.exists?(name: "Inbox")
  end
end
