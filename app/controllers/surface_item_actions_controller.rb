class SurfaceItemActionsController < ApplicationController
  def create
    item = SurfaceItem.find(params[:surface_item_id])
    action_id = params.require(:action_id)
    raise ActionController::BadRequest, "Unsupported action" unless SurfaceActions::Registry.supported?(action_id)

    case action_id
    when "discuss", "answer"
      conversation = conversation_for(item)
      feedback = SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: "discussed")
      Surfaces::LearnFromFeedback.call(feedback)
      redirect_to root_path(conversation_id: conversation.id)
    else
      redirect_to root_path, alert: "Action is not available."
    end
  end

  private

  def conversation_for(item)
    reference = Array(item.context_refs).find do |candidate|
      %w[project context].include?(candidate["type"] || candidate[:type])
    end
    raise ActiveRecord::RecordNotFound, "No interaction context is available" unless reference

    type = reference["type"] || reference[:type]
    id = reference["id"] || reference[:id]
    owner = type == "project" ? Project.active.find_by(id: id) : Context.active.find_by(id: id)
    raise ActiveRecord::RecordNotFound, "The interaction context is no longer active" unless owner

    Conversation.active_for(owner).first || Conversation.start!(owner, summary: item.title.truncate(120))
  end
end
