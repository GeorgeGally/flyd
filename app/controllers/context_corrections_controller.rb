class ContextCorrectionsController < ApplicationController
  def create
    item = SurfaceItem.find(params[:surface_item_id]) if params[:surface_item_id]
    intent = Intent.find(params[:intent_id]) if params[:intent_id]
    original = item&.context_refs || intent&.resolved_contexts || []
    corrected = normalized_contexts

    ContextCorrection.create!(
      surface_item: item,
      intent: intent,
      original_contexts: original,
      corrected_contexts: corrected,
      reason: params[:reason]
    )

    item&.update!(context_refs: corrected)
    SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: "corrected") if item

    if intent
      intent.update!(resolved_contexts: corrected, status: "accepted")
      continue_intent(intent, corrected)
    end

    ComposeSurfaceJob.enqueue(reason: "context_corrected", active_intent_id: intent&.id)
    redirect_to root_path(intent_id: intent&.id, conversation_id: intent&.conversation_id), notice: "Context corrected."
  end

  private

  def continue_intent(intent, contexts)
    project_context = contexts.find { |context| context["type"] == "project" }
    return unless project_context

    project = Project.active.find_by(id: project_context["id"])
    return unless project

    conversation = intent.conversation || project.active_conversation || Conversation.start!(project, summary: intent.input_text.truncate(120))
    unless intent.conversation
      message = conversation.messages.create!(role: "user", content: intent.input_text)
      intent.update!(conversation: conversation)
      LlmStreamingJob.perform_later(conversation.id, message.content)
    end
  end

  def normalized_contexts
    Array(params[:corrected_contexts]).filter_map do |context|
      value = context.respond_to?(:permit) ? context.permit(:type, :id, :name).to_h : context.to_h
      next if value["type"].blank? || value["id"].blank?

      value
    end
  end
end
