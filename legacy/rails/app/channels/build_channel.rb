class BuildChannel < ApplicationCable::Channel
  def subscribed
    build = Build.find(params[:build_id])
    stream_for build
  end

  def unsubscribed
  end
end
