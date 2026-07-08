class BuildsController < ApplicationController
  before_action :set_project
  before_action :set_conversation

  def create
    if @project.builds.where(status: %w[pending preparing running]).exists?
      redirect_to project_conversation_path(@project, @conversation), alert: "A build is already in progress."
      return
    end

    build = @project.builds.create!(
      conversation: @conversation,
      status: "pending"
    )

    OpencodeBuildJob.perform_later(build.id)
    redirect_to project_conversation_path(@project, @conversation), notice: "Build started."
  end

  def show
    @build = @project.builds.find(params[:id])
  end

  private

  def set_project
    @project = Project.find(params[:project_id])
  end

  def set_conversation
    @conversation = @project.conversations.find(params[:conversation_id])
  end
end
