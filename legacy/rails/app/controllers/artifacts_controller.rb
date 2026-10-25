class ArtifactsController < ApplicationController
  def show
    @artifact = Artifact.includes(:scene, :project, :context, :conversation, :build).find(params[:id])
  end
end
