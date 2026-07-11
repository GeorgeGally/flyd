class IntentsController < ApplicationController
  def create
    text = intent_params[:text].to_s.strip
    return redirect_to root_path, alert: "Say something first." if text.blank?

    resolution = ContextResolver.call(
      text: text,
      preferred_project_id: intent_params[:project_id]
    )

    project = resolution.project || Project.active.first || Project.create!(name: "General", description: "Unsorted Flyd context")
    conversation = project.active_conversation || Conversation.start!(project, summary: text.truncate(120))
    message = conversation.messages.create!(role: "user", content: text)

    LlmStreamingJob.perform_later(conversation.id, message.content)
    DecisionExtractionJob.perform_later(conversation.id) if conversation.messages.count % 5 == 0

    redirect_to project_conversation_path(project, conversation), notice: context_notice(resolution)
  end

  private

  def intent_params
    params.require(:intent).permit(:text, :project_id)
  end

  def context_notice(resolution)
    return "Flyd created a general context." unless resolution.project

    "Context: #{resolution.project.name} (#{(resolution.confidence * 100).round}% confidence)"
  end
end
