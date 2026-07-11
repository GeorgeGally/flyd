class ComposeSurfaceJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "surface:composition_enqueued"
  LOCK_TTL = 5.minutes

  retry_on Llm::Chat::Error, wait: :exponentially_longer, attempts: 3

  def self.enqueue(reason:, active_conversation_id: nil, force: false)
    return false unless force || Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)

    perform_later(reason: reason, active_conversation_id: active_conversation_id)
    true
  rescue ActiveJob::EnqueueError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  def perform(reason:, active_conversation_id: nil)
    conversation = Conversation.includes(:messages, :project).find_by(id: active_conversation_id)
    plan = Flyd::Intelligence.compose_surface(active_conversation: conversation, fallback: false)
    digest = IntelligenceSnapshot.newest_first.first&.state_digest
    draft = Surfaces::PersistPlan.call(
      plan: plan,
      source_state_digest: digest,
      composition_version: "flyd-1"
    )
    draft.update!(metadata: draft.metadata.merge("composition_reason" => reason))
    surface = Surface.activate!(draft)

    Turbo::StreamsChannel.broadcast_replace_to(
      "flyd_surface",
      target: "surface_plane",
      partial: "surfaces/plane",
      locals: { surface: surface }
    )
  rescue StandardError => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    raise
  ensure
    Rails.cache.delete(LOCK_KEY)
  end
end
