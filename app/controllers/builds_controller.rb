class BuildsController < ApplicationController
  before_action :set_project_and_conversation, only: :create
  before_action :set_build, only: [ :show, :confirm ]

  def create
    build = Builds::Propose.call(
      project: @project,
      conversation: @conversation,
      scene: @conversation.primary_scene
    )
    redirect_to build_path(build), notice: build.proposed? ? "Review the build before it runs." : "This work already has an active build."
  rescue ArgumentError => error
    redirect_to root_path(conversation_id: @conversation.id), alert: error.message
  end

  def show
  end

  def confirm
    if @build.proposed?
      @build.confirm!
      begin
        OpencodeBuildJob.perform_later(@build.id)
        redirect_to build_path(@build), notice: "Build confirmed and queued."
      rescue StandardError => error
        @build.revert_confirmation!
        Rails.logger.error("Build #{@build.id} confirmation could not be queued: #{error.class}: #{error.message}")
        redirect_to build_path(@build), alert: "The build could not be queued. Try again."
      end
    else
      redirect_to build_path(@build), alert: "This build can no longer be confirmed."
    end
  end

  private

  def set_project_and_conversation
    @project = Project.find(params[:project_id])
    @conversation = @project.conversations.find(params[:conversation_id])
  end

  def set_build
    @build = Build.includes(:project, :conversation, :scene, :artifact).find(params[:id])
  end
end
