class SurfaceItemActionsController < ApplicationController
  def create
    item = SurfaceItem.find(params[:surface_item_id])
    action_id = params.require(:action_id)
    raise ActionController::BadRequest, "Unsupported action" unless SurfaceActions::Registry.supported?(action_id)

    case action_id
    when "discuss", "answer"
      conversation = conversation_for(item)
      SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: "discussed")
      redirect_to root_path(conversation_id: conversation.id)
    else
      redirect_to root_path, alert: "Action is not available yet."
    end
  end

  private

  def conversation_for(item)
    project_id = item.context_refs.filter_map do |reference|
      type = reference["type"] || reference[:type]
      id = reference["id"] || reference[:id]
      id if type == "project"
    end.first

    project = Project.active.find_by(id: project_id)
    raise ActiveRecord::RecordNotFound, "No project context is available" unless project

    project.active_conversation || Conversation.start!(project, summary: item.title.truncate(120))
  end
end
