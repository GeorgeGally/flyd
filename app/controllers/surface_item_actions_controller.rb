class SurfaceItemActionsController < ApplicationController
  def create
    item = SurfaceItem.includes(:scene, :surface).find(params[:surface_item_id])
    action_id = params.require(:action_id)
    raise ActionController::BadRequest, "Unsupported action" unless SurfaceActions::Registry.supported?(action_id)

    case action_id
    when "discuss", "answer"
      conversation = conversation_for(item)
      feedback = SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: "discussed")
      Surfaces::LearnFromFeedback.call(feedback)
      redirect_to root_path(conversation_id: conversation.id)
    when "build"
      build = propose_build(item)
      redirect_to build_path(build), notice: build.proposed? ? "Review the build before it runs." : "This scene already has an active build."
    else
      redirect_to root_path, alert: "Action is not available."
    end
  rescue ArgumentError, ActiveRecord::RecordNotFound => error
    redirect_to root_path, alert: error.message
  end

  private

  def propose_build(item)
    conversation = conversation_for(item)
    raise ArgumentError, "Build currently requires a project-owned scene" unless conversation.project

    Builds::Propose.call(
      project: conversation.project,
      conversation: conversation,
      scene: item.scene || conversation.primary_scene,
      surface_item: item,
      instructions: params.dig(:payload, :instructions)
    )
  end

  def conversation_for(item)
    return item.scene.conversation if item.scene&.conversation&.continuable?

    reference = Array(item.context_refs).find do |candidate|
      %w[project context].include?(candidate["type"] || candidate[:type])
    end
    raise ActiveRecord::RecordNotFound, "No interaction context is available" unless reference

    type = reference["type"] || reference[:type]
    id = reference["id"] || reference[:id]
    owner = type == "project" ? Project.active.find_by(id: id) : Context.active.find_by(id: id)
    raise ActiveRecord::RecordNotFound, "The interaction context is no longer active" unless owner

    conversation = Conversation.active_for(owner).first || Conversation.start!(owner, summary: item.title.truncate(120))
    if item.scene
      item.scene.update!(
        conversation: conversation,
        project: owner.is_a?(Project) ? owner : nil,
        context: owner.is_a?(Context) ? owner : nil
      )
    end
    conversation
  end
end
