class IntentsController < ApplicationController
  def create
    text = intent_params[:text].to_s.strip
    return redirect_to root_path, alert: "Say something first." if text.blank?

    intent = Intent.create!(
      input_text: text,
      modality: intent_params[:modality].presence || "text",
      origin_surface: Surface.current,
      attachments: [],
      metadata: { "preferred_project_id" => intent_params[:project_id].presence }
    )

    InterpretIntentJob.perform_later(intent.id, preferred_project_id: intent_params[:project_id])
    ComposeSurfaceJob.enqueue(reason: "intent_received", active_intent_id: intent.id)

    redirect_to root_path(intent_id: intent.id), notice: "Flyd is interpreting this."
  end

  private

  def intent_params
    params.require(:intent).permit(:text, :project_id, :modality)
  end
end
