class ContextCorrectionsController < ApplicationController
  def create
    item = SurfaceItem.find(params[:surface_item_id]) if params[:surface_item_id]
    intent = Intent.find(params[:intent_id]) if params[:intent_id]
    original = item&.context_refs || intent&.resolved_contexts || []
    corrected = normalized_contexts

    correction = ContextCorrection.create!(
      surface_item: item,
      intent: intent,
      original_contexts: original,
      corrected_contexts: corrected,
      reason: params[:reason]
    )

    item&.update!(context_refs: corrected)
    intent&.update!(resolved_contexts: corrected, status: corrected.empty? ? "clarification_required" : "accepted")
    SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: "corrected") if item
    ComposeSurfaceJob.enqueue(reason: "context_corrected", active_intent_id: intent&.id)

    redirect_to root_path(intent_id: intent&.id), notice: "Context corrected."
  end

  private

  def normalized_contexts
    Array(params[:corrected_contexts]).filter_map do |context|
      value = context.respond_to?(:permit) ? context.permit(:type, :id, :name).to_h : context.to_h
      next if value["type"].blank? || value["id"].blank?

      value
    end
  end
end
