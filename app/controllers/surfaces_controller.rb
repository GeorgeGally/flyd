class SurfacesController < ApplicationController
  skip_before_action :load_sidebar_projects

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
    return unless conversation_mode?

    remembered_id = @surface.metadata["active_conversation_id"]
    remembered = Conversation.includes(:messages, :project, :context).find_by(id: remembered_id)
    return remembered if remembered&.continuable?

    scene_conversation = Scene.continue_scene&.conversation
    return scene_conversation if scene_conversation&.continuable?

    Conversation.continuable.includes(:messages, :project, :context).detect(&:continuable?)
  end

  def conversation_mode?
    %w[conversation interaction].include?(@surface.metadata["surface_mode"].to_s)
  end

  def prepare_next_surface
    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::CliProvider::PROVIDER)
    enqueue_without_blocking { RefreshIntelligenceStateJob.enqueue } if snapshot.nil? || !snapshot.fresh?

    explicit_interaction = params[:conversation_id].present? || @intent&.conversation_id.present?
    interaction_changed = explicit_interaction && @conversation && @surface.metadata["active_conversation_id"].to_i != @conversation.id
    return unless @surface.stale? || @surface.metadata["fallback"] || interaction_changed

    enqueue_without_blocking do
      ComposeSurfaceJob.enqueue(
        reason: interaction_changed ? "explicit_interaction" : (@surface.metadata["fallback"] ? "surface_missing" : "surface_stale"),
        active_conversation_id: @conversation&.id,
        active_intent_id: @intent&.id
      )
    end
  end

  def enqueue_without_blocking
    yield
  rescue StandardError => error
    Rails.logger.warn("Flyd background enqueue failed while rendering the persisted surface: #{error.class}: #{error.message}")
  end

  def surface_enabled?
    Rails.application.config_for(:flyd).fetch(:generated_surface_enabled, false)
  end
end
