class IntentsController < ApplicationController
  def create
    text = intent_params[:text].to_s.strip
    return redirect_to root_path, alert: "Say something first." if text.blank?

    resolution = ContextResolver.call(text: text, preferred_project_id: intent_params[:project_id])
    project = resolution.project || neutral_project
    conversation = project.active_conversation || Conversation.start!(project, summary: text.truncate(120))
    message = conversation.messages.create!(role: "user", content: text)

    LlmStreamingJob.perform_later(conversation.id, message.content)
    DecisionExtractionJob.perform_later(conversation.id) if conversation.messages.count % 5 == 0
    ComposeSurfaceJob.enqueue(reason: "new_intent", active_conversation_id: conversation.id)

    redirect_to root_path(conversation_id: conversation.id), notice: context_notice(resolution, project)
  end

  private

  def intent_params
    params.require(:intent).permit(:text, :project_id)
  end

  def neutral_project
    project = Project.find_or_initialize_by(name: "Inbox")
    project.description ||= "Unresolved and cross-project Flyd context"
    project.archived_at = nil
    project.save!
    project
  end

  def context_notice(resolution, project)
    return "Held in Inbox until the context is clear." if resolution.requires_confirmation

    "Context: #{project.name} (#{(resolution.confidence * 100).round}% confidence)"
  end
end
