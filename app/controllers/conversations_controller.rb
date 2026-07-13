class ConversationsController < ApplicationController
  before_action :set_project, only: [ :create, :destroy ]

  def show
    @conversation = Conversation.find(params[:id])
    @project = @conversation.project
    @context = @conversation.context
  end

  def create
    @conversation = Conversation.start!(@project)
    redirect_to project_conversation_path(@project, @conversation)
  end

  def destroy
    @conversation = @project.conversations.find(params[:id])
    @conversation.archive!
    redirect_to project_path(@project), notice: "Conversation archived."
  end

  private

  def set_project
    @project = Project.find(params[:project_id])
  end
end
