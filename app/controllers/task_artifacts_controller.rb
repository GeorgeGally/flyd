class TaskArtifactsController < ApplicationController
  def show
    artifact = TaskArtifact.find_by!(artifact_key: params[:artifact_key])
    resolved = TaskArtifacts::Resolver.call(artifact)

    if resolved.path
      send_file(
        resolved.path,
        type: resolved.media_type,
        filename: resolved.filename,
        disposition: resolved.disposition
      )
    else
      send_data(
        resolved.content,
        type: resolved.media_type,
        filename: resolved.filename,
        disposition: resolved.disposition
      )
    end
  rescue ActiveRecord::RecordNotFound, TaskArtifacts::Resolver::ResolutionError
    head :not_found
  end
end
