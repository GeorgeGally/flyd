class BroadcastSurfaceJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :polynomially_longer, attempts: 5

  def perform(surface_id)
    surface = Surface.includes(:surface_items).find(surface_id)
    return unless surface.active?

    Turbo::StreamsChannel.broadcast_replace_to(
      "flyd_surface",
      target: "surface_plane",
      partial: "surfaces/plane",
      locals: { surface: surface, active_conversation: nil },
      method: :morph
    )
  end
end
