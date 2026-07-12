class InterpretIntentJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(intent_id, preferred_project_id: nil)
    intent = Intent.includes(:intent_attachments).find(intent_id)
    intent.update!(status: "interpreting")
    interpretation_text = effective_text(intent)

    resolution = ContextResolver.call(text: interpretation_text, preferred_project_id: preferred_project_id)
    intent.update!(
      context_candidates: context_candidates(resolution),
      interpretation: {
        "confidence" => resolution.confidence,
        "reason" => resolution.reason,
        "requires_confirmation" => resolution.requires_confirmation,
        "evidence_modalities" => intent.intent_attachments.map(&:modality).uniq
      }
    )

    if resolution.owner && !resolution.requires_confirmation
      accept_in_owner(intent, resolution.owner, interpretation_text)
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
    Array(resolution.candidates).map do |candidate|
      {
        "type" => candidate.type,
        "id" => candidate.record.id,
        "name" => candidate.record.name,
        "confidence" => candidate == resolution.candidates.first ? resolution.confidence : nil,
        "reason" => resolution.reason
      }.compact
    end
  end

  def accept_in_owner(intent, owner, interpretation_text)
    conversation = Conversation.active_for(owner).first || Conversation.start!(owner, summary: interpretation_text.truncate(120))
    message = conversation.messages.create!(role: "user", content: interpretation_text)
    context_type = owner.is_a?(Project) ? "project" : "context"
    intent.update!(
      status: "accepted",
      conversation: conversation,
      resolved_contexts: [{ "type" => context_type, "id" => owner.id, "name" => owner.name }],
      metadata: intent.metadata.merge("source_message_id" => message.id)
    )

    LlmStreamingJob.perform_later(conversation.id, message.content)
    DecisionExtractionJob.perform_later(conversation.id) if owner.is_a?(Project) && conversation.messages.count % 5 == 0
    ComposeSurfaceJob.enqueue(reason: "new_intent", active_conversation_id: conversation.id, active_intent_id: intent.id)
  end
end
