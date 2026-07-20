class ProjectsController < ApplicationController
  before_action :set_project, only: %i[show edit update destroy archive reactivate]

  def index
    @active_projects = Project.active.by_recent_activity.to_a
    @archived_projects = Project.archived.by_recent_activity.to_a
  end

  def show
  end

  def new
    @project = Project.new
  end

  def edit
  end

  def create
    @project = Project.new(project_params)
    if @project.save
      redirect_to @project, notice: "Project created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def update
    if @project.update(project_params)
      redirect_to @project, notice: "Project updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @project.destroy!
    redirect_to projects_path, notice: "Project deleted."
  end

  def archive
    @project.archive!
    redirect_to projects_path, notice: "Project archived."
  end

  def reactivate
    @project.reactivate!
    redirect_to project_path(@project), notice: "Project reactivated."
  end

  private

  def set_project
    @project = Project.find(params[:id])
  end

  def project_params
    params.require(:project).permit(:name, :description, :root_path)
  end
end
