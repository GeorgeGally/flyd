class ContextsController < ApplicationController
  def create
    intent = Intent.find(params[:intent_id])
    context = Context.create!(
      name: context_params[:name],
      kind: context_params[:kind].presence || "temporary",
      description: context_params[:description],
      expires_at: context_params[:expires_at].presence || 7.days.from_now,
      metadata: { "created_from_intent_id" => intent.id }
    )

    reference = { "type" => "context", "id" => context.id, "name" => context.name }
    ContextCorrection.create!(
      intent: intent,
      original_contexts: intent.resolved_contexts,
      corrected_contexts: [ reference ],
      reason: "Created temporary context"
    )
    conversation = Intents::ApplyContextCorrection.call(intent: intent, corrected_contexts: [ reference ])
    ComposeSurfaceJob.enqueue(
      reason: "temporary_context_created",
      active_intent_id: intent.id,
      active_conversation_id: conversation&.id
    )

    redirect_to root_path(intent_id: intent.id, conversation_id: conversation&.id), notice: "Created context: #{context.name}"
  end

  private

  def context_params
    params.require(:context).permit(:name, :kind, :description, :expires_at)
  end
end
