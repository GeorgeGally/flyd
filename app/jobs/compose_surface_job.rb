class ComposeSurfaceJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "surface:composition_enqueued"
  LOCK_TTL = 5.minutes
  RETRYABLE_ERRORS = [Llm::Chat::Error, JSON::ParserError, KeyError, ArgumentError].freeze

  retry_on(*RETRYABLE_ERRORS, wait: :exponentially_longer, attempts: 3) do |_job, _error|
    Rails.cache.delete(LOCK_KEY)
  end

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
    digest = IntelligenceSnapshot.latest_for(IntelligenceState::CliProvider::PROVIDER)&.state_digest
    draft = Surfaces::PersistPlan.call(
      plan: plan,
      source_state_digest: digest,
      composition_version: "flyd-1"
    )
    draft.update!(metadata: draft.metadata.merge("composition_reason" => reason))
    surface = Surface.activate!(draft)

    broadcast(surface)
    Rails.cache.delete(LOCK_KEY)
  rescue *RETRYABLE_ERRORS => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    raise
  rescue StandardError => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  private

  def broadcast(surface)
    Turbo::StreamsChannel.broadcast_replace_to(
      "flyd_surface",
      target: "surface_plane",
      partial: "surfaces/plane",
      locals: { surface: surface }
    )
  rescue StandardError => error
    Rails.logger.warn("Surface #{surface.id} activated but broadcast failed: #{error.message}")
  end
end
