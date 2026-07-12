class SurfacesController < ApplicationController
  def show
    unless surface_enabled?
      redirect_to projects_path
      return
    end

    @surface = Surface.fallback!
    @intent = Intent.find_by(id: params[:intent_id])
    @conversation = resolve_conversation
    @preferred_project = Project.active.find_by(id: params[:project_id])

    prepare_next_surface
  end

  private

  def resolve_conversation
    explicit = Conversation.includes(:messages, :project, :context).find_by(id: params[:conversation_id])
    return explicit if explicit
    return @intent.conversation if @intent&.conversation

    remembered_id = @surface.metadata["active_conversation_id"]
    remembered = Conversation.includes(:messages, :project, :context).find_by(id: remembered_id)
    return remembered if remembered&.continuable?

    scene_conversation = Scene.continue_scene&.conversation
    return scene_conversation if scene_conversation&.continuable?

    Conversation.continuable.includes(:messages, :project, :context).detect(&:continuable?)
  end

  def prepare_next_surface
    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::CliProvider::PROVIDER)
    RefreshIntelligenceStateJob.enqueue if snapshot.nil? || !snapshot.fresh?

    continuation_changed = @conversation && @surface.metadata["active_conversation_id"].to_i != @conversation.id
    return unless @surface.stale? || @surface.metadata["fallback"] || continuation_changed

    ComposeSurfaceJob.enqueue(
      reason: continuation_changed ? "continue_active_work" : (@surface.metadata["fallback"] ? "surface_missing" : "surface_stale"),
      active_conversation_id: @conversation&.id,
      active_intent_id: @intent&.id
    )
  end

  def surface_enabled?
    Rails.application.config_for(:flyd).fetch(:generated_surface_enabled, false)
  end
end
