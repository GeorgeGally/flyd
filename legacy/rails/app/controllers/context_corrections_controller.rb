class ContextCorrectionsController < ApplicationController
  def create
    item = SurfaceItem.find(params[:surface_item_id]) if params[:surface_item_id]
    authorize_item_action!(item)
    intent = resolve_intent(item)
    original = item&.context_refs || intent&.resolved_contexts || []
    corrected = ContextReferences::Validator.call(params[:corrected_contexts])

    correction = ContextCorrection.create!(
      surface_item: item,
      intent: intent,
      original_contexts: original,
      corrected_contexts: corrected,
      reason: params[:reason]
    )

    item&.update!(context_refs: corrected)
    SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: "corrected", metadata: { "context_correction_id" => correction.id }) if item

    conversation = Intents::ApplyContextCorrection.call(intent: intent, corrected_contexts: corrected) if intent
    ComposeSurfaceJob.enqueue(
      reason: "context_corrected",
      active_intent_id: intent&.id,
      active_conversation_id: conversation&.id
    )

    redirect_to root_path(intent_id: intent&.id, conversation_id: conversation&.id), notice: "Context corrected."
  rescue ContextReferences::Validator::InvalidReference, ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound, ArgumentError => error
    redirect_to root_path(intent_id: params[:intent_id]), alert: error.message
  end

  private

  def resolve_intent(item)
    return Intent.find(params[:intent_id]) if params[:intent_id]
    return unless item

    return item.scene.intent if item.scene&.intent

    reference = Array(item.source_refs).find { |source| (source["type"] || source[:type]) == "intent" }
    Intent.find_by(id: reference && (reference["id"] || reference[:id]))
  end

  def authorize_item_action!(item)
    return unless item
    return if item.offers_action?("correct_context")

    raise ArgumentError, "Action is not available for this item."
  end
end
