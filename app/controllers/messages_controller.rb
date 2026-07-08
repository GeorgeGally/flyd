class MessagesController < ApplicationController
  before_action :set_conversation

  def create
    @message = @conversation.messages.new(message_params)
    if @message.save
      LlmStreamingJob.perform_later(@conversation.id, @message.content)

      if @conversation.messages.count % 5 == 0
        DecisionExtractionJob.perform_later(@conversation.id)
      end

      respond_to do |format|
        format.json { head :created }
        format.html { redirect_to project_conversation_path(@conversation.project, @conversation) }
      end
    else
      respond_to do |format|
        format.json { render json: { errors: @message.errors.full_messages }, status: :unprocessable_entity }
        format.html { redirect_to project_conversation_path(@conversation.project, @conversation), alert: @message.errors.full_messages.to_sentence }
      end
    end
  end

  private

  def set_conversation
    @conversation = Conversation.find(params[:conversation_id])
  end

  def message_params
    params.require(:message).permit(:content).merge(role: "user")
  end
end
