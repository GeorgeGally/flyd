class InterpretIntentJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(intent_id, preferred_project_id: nil)
    intent = Intent.includes(:intent_attachments).find(intent_id)
    intent.update!(status: "interpreting")
    interpretation_text = effective_text(intent)

    resolution = ContextResolver.call(text: interpretation_text, preferred_project_id: preferred_project_id)
    candidates = context_candidates(resolution)
    intent.update!(
      context_candidates: candidates,
      interpretation: {
        "confidence" => resolution.confidence,
        "reason" => resolution.reason,
        "requires_confirmation" => resolution.requires_confirmation,
        "evidence_modalities" => intent.intent_attachments.map(&:modality).uniq
      }
    )

    if resolution.project && !resolution.requires_confirmation
      accept_in_project(intent, resolution.project, interpretation_text)
    else
      intent.update!(status: "clarification_required", resolved_contexts: [])
      ComposeSurfaceJob.enqueue(reason: "intent_clarification", active_intent_id: intent.id)
    end
  rescue StandardError => error
    intent&.fail!(error)
    raise
  end

  private

  def effective_text(intent)
    parts = [ intent.input_text ]
    parts.concat(intent.intent_attachments.filter_map(&:extracted_text))
    text = parts.compact_blank.join("\n\n").truncate(20_000)
    text.presence || "#{intent.modality} attachment requiring interpretation"
  end

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

  def accept_in_project(intent, project, interpretation_text)
    conversation = project.active_conversation || Conversation.start!(project, summary: interpretation_text.truncate(120))
    message = conversation.messages.create!(role: "user", content: interpretation_text)
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
