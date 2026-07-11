class SurfacesController < ApplicationController
  def show
    unless surface_enabled?
      redirect_to projects_path
      return
    end

    @surface = Surface::Planner.call
    @conversation = Conversation.includes(:messages, :project).find_by(id: params[:conversation_id])
  end

  private

  def surface_enabled?
    Rails.application.config_for(:flyd).fetch("generated_surface_enabled", false)
  end
end
