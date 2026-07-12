class SurfacesController < ApplicationController
  def show
    unless surface_enabled?
      redirect_to projects_path
      return
    end

    @intent = Intent.find_by(id: params[:intent_id])
    @conversation = Conversation.includes(:messages, :project).find_by(id: params[:conversation_id]) || @intent&.conversation
    @surface = Surface.fallback!
    @preferred_project = Project.active.find_by(id: params[:project_id])

    prepare_next_surface
  end

  private

  def prepare_next_surface
    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::CliProvider::PROVIDER)

    if snapshot.nil? || !snapshot.fresh?
      RefreshIntelligenceStateJob.enqueue
    elsif @surface.stale? || @surface.metadata["fallback"]
      ComposeSurfaceJob.enqueue(
        reason: @surface.metadata["fallback"] ? "surface_missing" : "surface_stale",
        active_conversation_id: @conversation&.id,
        active_intent_id: @intent&.id
      )
    end
  end

  def surface_enabled?
    Rails.application.config_for(:flyd).fetch(:generated_surface_enabled, false)
  end
end
