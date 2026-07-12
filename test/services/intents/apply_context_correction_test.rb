require "test_helper"

class Intents::ApplyContextCorrectionTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  test "moves only the corrected intent segment and its derived memory" do
    wrong_project = Project.create!(name: "Wrong project")
    correct_project = Project.create!(name: "Correct project")
    conversation = Conversation.start!(wrong_project)

    unrelated_message = conversation.messages.create!(role: "user", content: "Keep this here")
    conversation.messages.create!(role: "assistant", content: "Unrelated response")
    corrected_message = conversation.messages.create!(role: "user", content: "Move this intent")
    corrected_response = conversation.messages.create!(role: "assistant", content: "Response to move")

    unrelated_intent = Intent.create!(
      input_text: unrelated_message.content,
      status: "accepted",
      conversation: conversation,
      metadata: { "source_message_id" => unrelated_message.id }
    )
    intent = Intent.create!(
      input_text: corrected_message.content,
      status: "accepted",
      conversation: conversation,
      metadata: { "source_message_id" => corrected_message.id }
    )

    unrelated_decision = wrong_project.decisions.create!(
      conversation: conversation,
      source_message: unrelated_message,
      content: "Unrelated decision",
      extracted_at: Time.current
    )
    corrected_decision = wrong_project.decisions.create!(
      conversation: conversation,
      source_message: corrected_message,
      content: "Corrected decision",
      extracted_at: Time.current
    )
    belief = wrong_project.beliefs.create!(
      statement: "Combined belief",
      confidence: 0.7,
      source_decision_ids: [ unrelated_decision.id, corrected_decision.id ]
    )

    conversation_result = Intents::ApplyContextCorrection.call(
      intent: intent,
      corrected_contexts: [{ "type" => "project", "id" => correct_project.id, "name" => correct_project.name }]
    )

    assert_equal correct_project, conversation_result.project
    assert conversation.reload.active?
    assert_equal conversation, unrelated_intent.reload.conversation
    assert_not unrelated_message.reload.context_superseded?
    assert corrected_message.reload.context_superseded?
    assert corrected_response.reload.context_superseded?

    assert_equal wrong_project, unrelated_decision.reload.project
    assert_equal conversation, unrelated_decision.conversation
    assert_equal correct_project, corrected_decision.reload.project
    assert_equal conversation_result, corrected_decision.conversation
    assert_equal intent.reload.metadata["source_message_id"].to_i, corrected_decision.source_message_id

    assert_equal [ unrelated_decision.id ], belief.reload.source_decision_ids.map(&:to_i)
    assert_equal "challenged", belief.status
  end
end
