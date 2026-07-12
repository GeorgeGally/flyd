class InterpretIntentJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(intent_id, preferred_project_id: nil)
    intent = Intent.find(intent_id)
    intent.update!(status: "interpreting")

    resolution = ContextResolver.call(text: intent.input_text, preferred_project_id: preferred_project_id)
    candidates = context_candidates(resolution)
    intent.update!(
      context_candidates: candidates,
      interpretation: {
        "confidence" => resolution.confidence,
        "reason" => resolution.reason,
        "requires_confirmation" => resolution.requires_confirmation
      }
    )

    if resolution.project && !resolution.requires_confirmation
      accept_in_project(intent, resolution.project)
    else
      intent.update!(status: "clarification_required", resolved_contexts: [])
      ComposeSurfaceJob.enqueue(reason: "intent_clarification", active_intent_id: intent.id)
    end
  rescue StandardError => error
    intent&.fail!(error)
    raise
  end

  private

  def context_candidates(resolution)
    return [] unless resolution.project

    [{
      "type" => "project",
      "id" => resolution.project.id,
      "name" => resolution.project.name,
      "confidence" => resolution.confidence,
      "reason" => resolution.reason
    }]
  end

  def accept_in_project(intent, project)
    conversation = project.active_conversation || Conversation.start!(project, summary: intent.input_text.truncate(120))
    message = conversation.messages.create!(role: "user", content: intent.input_text)
    intent.update!(
      status: "accepted",
      conversation: conversation,
      resolved_contexts: [{ "type" => "project", "id" => project.id, "name" => project.name }]
    )

    LlmStreamingJob.perform_later(conversation.id, message.content)
    DecisionExtractionJob.perform_later(conversation.id) if conversation.messages.count % 5 == 0
    ComposeSurfaceJob.enqueue(reason: "new_intent", active_conversation_id: conversation.id, active_intent_id: intent.id)
  end
end
