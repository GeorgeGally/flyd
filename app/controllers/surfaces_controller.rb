class SurfacesController < ApplicationController
  def show
    unless surface_enabled?
      redirect_to projects_path
      return
    end

    @conversation = Conversation.includes(:messages, :project).find_by(id: params[:conversation_id])
    @surface = Flyd::Intelligence.compose_surface(active_conversation: @conversation)
    @preferred_project = Project.active.find_by(id: params[:project_id])
    @surface_projects = Project.where(id: surface_project_ids).index_by(&:id)
  end

  private

  def surface_project_ids
    @surface.items.flat_map(&:context_refs).filter_map do |ref|
      ref[:id] if ref[:type] == "project"
    end.uniq
  end

  def surface_enabled?
    Rails.application.config_for(:flyd).fetch(:generated_surface_enabled, false)
  end
end
