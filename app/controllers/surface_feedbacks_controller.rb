class SurfaceFeedbacksController < ApplicationController
  SIGNAL_MAP = {
    "dismiss" => "dismissed",
    "resolve" => "resolved",
    "approve" => "resolved",
    "reject" => "dismissed"
  }.freeze

  def create
    item = SurfaceItem.includes(:scene, :surface).find(params[:surface_item_id])
    requested_signal = params.require(:signal)
    signal = SIGNAL_MAP.fetch(requested_signal, requested_signal)
    authorize_item_action!(item, signal)
    feedback = nil

    SurfaceItem.transaction do
      feedback = item.surface_feedbacks.create!(
        surface: item.surface,
        signal: signal,
        metadata: permitted_payload
      )
      apply_lifecycle(item, feedback)
      Surfaces::LearnFromFeedback.call(feedback)
    end

    conversation_id = item.scene&.conversation_id
    ComposeSurfaceJob.enqueue(reason: "surface_#{feedback.signal}", active_conversation_id: conversation_id)

    redirect_to root_path(conversation_id: conversation_id), notice: feedback.signal.humanize
  end

  private

  def authorize_item_action!(item, signal)
    action_id = signal == "dismissed" ? "dismiss" : "resolve"
    return if item.offers_action?(action_id)

    raise ActionController::BadRequest, "Action is not available for this item."
  end

  def apply_lifecycle(item, feedback)
    case feedback.signal
    when "dismissed"
      item.scene&.dismiss!
      item.update!(state: "dismissed")
    when "resolved"
      artifact = resolve_scene(item, feedback.metadata)
      item.update!(
        state: "collapsed",
        metadata: item.metadata.merge(
          "collapsed_at" => Time.current.iso8601,
          "collapsed_summary" => item.summary,
          "artifact_id" => artifact.id
        )
      )
    end
  end

  def resolve_scene(item, metadata)
    scene = item.scene || Scene.create!(
      scene_key: item.item_key,
      kind: "work",
      status: "active",
      title: item.title,
      summary: item.summary,
      desired_outcome: item.summary,
      last_presented_at: Time.current
    )
    item.update!(scene: scene) unless item.scene_id

    content = metadata["note"].presence || item.summary
    artifact = scene.artifacts.create!(
      project: scene.project,
      context: scene.context,
      conversation: scene.conversation,
      kind: "resolution",
      status: "ready",
      title: "Resolved: #{item.title}",
      content: content,
      metadata: {
        "surface_id" => item.surface_id,
        "surface_item_id" => item.id,
        "reason" => metadata["reason"]
      }.compact
    )
    scene.resolve!(artifact: artifact, summary: content)
    artifact
  end

  def permitted_payload
    params.fetch(:payload, {}).permit(
      :reason,
      :value,
      :note,
      :artifact_id,
      contexts: [],
      source_refs: []
    ).to_h
  end
end
