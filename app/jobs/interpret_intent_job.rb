class InterpretIntentJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def perform(intent_id, preferred_project_id: nil)
    intent = Intent.includes(:intent_attachments).find(intent_id)
    intent.update!(status: "interpreting")
    interpretation_text = effective_text(intent)
    meaning = Flyd::IntentInterpreter.call(text: interpretation_text)

    resolution = ContextResolver.call(text: interpretation_text, preferred_project_id: preferred_project_id)
    intent.update!(
      requested_capability: meaning.requested_capability,
      context_candidates: context_candidates(resolution),
      interpretation: {
        "summary" => meaning.summary,
        "desired_outcome" => meaning.desired_outcome,
        "requested_capability" => meaning.requested_capability,
        "confidence" => resolution.confidence,
        "context_reason" => resolution.reason,
        "requires_confirmation" => resolution.requires_confirmation,
        "evidence_modalities" => intent.intent_attachments.map(&:modality).uniq
      }
    )

    if resolution.owner && !resolution.requires_confirmation
      accept_in_owner(intent, resolution.owner, interpretation_text, meaning)
    elsif meaning.requested_capability == "discuss"
      accept_in_owner(intent, Context.personal, interpretation_text, meaning)
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

  def accept_in_owner(intent, owner, interpretation_text, meaning)
    conversation = Conversation.active_for(owner).first || Conversation.start!(owner, summary: meaning.summary.truncate(120))
    scene = conversation.primary_scene
    scene&.update!(
      title: (meaning.requested_capability == "discuss" ? interpretation_text : meaning.summary).truncate(180),
      summary: interpretation_text.truncate(1_000),
      desired_outcome: meaning.desired_outcome.truncate(1_000),
      intent: intent,
      project: owner.is_a?(Project) ? owner : nil,
      context: owner.is_a?(Context) ? owner : nil,
      status: "active"
    )

    message = conversation.messages.create!(role: "user", content: interpretation_text)
    context_type = owner.is_a?(Project) ? "project" : "context"
    intent.update!(
      status: "accepted",
      conversation: conversation,
      resolved_contexts: [ { "type" => context_type, "id" => owner.id, "name" => owner.name } ],
      metadata: intent.metadata.merge("source_message_id" => message.id, "scene_id" => scene&.id)
    )

    ArchiveEventJob.perform_later(
      "event_key" => "intent:#{intent.id}:accepted",
      "body" => interpretation_text,
      "event_type" => "intent",
      "outcome" => "accepted",
      "project" => owner.name,
      "record_type" => "Intent",
      "record_id" => intent.id,
      "timestamp" => Time.current.iso8601
    )

    LlmStreamingJob.perform_later(conversation.id, message.content)
    DecisionExtractionJob.perform_later(conversation.id) if owner.is_a?(Project) && conversation.messages.count % 5 == 0
    ComposeSurfaceJob.enqueue(reason: "new_intent", active_conversation_id: conversation.id, active_intent_id: intent.id)
  end
end
