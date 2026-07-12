class SurfaceFeedbacksController < ApplicationController
  def create
    item = SurfaceItem.find(params[:surface_item_id])
    signal = params.require(:signal)
    feedback = item.surface_feedbacks.create!(
      surface: item.surface,
      signal: signal,
      metadata: permitted_payload
    )

    apply_lifecycle(item, feedback.signal)
    ComposeSurfaceJob.enqueue(reason: "surface_#{feedback.signal}")

    redirect_to root_path, notice: feedback.signal.humanize
  end

  private

  def apply_lifecycle(item, signal)
    case signal
    when "dismissed", "reject"
      item.update!(state: "dismissed")
    when "resolved", "approve"
      item.update!(state: "resolved")
      collapse_resolution(item)
    end
  end

  def collapse_resolution(item)
    item.update!(
      state: "collapsed",
      metadata: item.metadata.merge(
        "collapsed_at" => Time.current.iso8601,
        "collapsed_summary" => item.summary
      )
    )
  end

  def permitted_payload
    params.fetch(:payload, {}).permit!.to_h
  end
end
