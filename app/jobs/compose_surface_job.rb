class ComposeSurfaceJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "surface:composition_enqueued"
  PENDING_KEY = "surface:composition_pending"
  LOCK_TTL = 5.minutes
  RETRYABLE_ERRORS = [Llm::Chat::Error, JSON::ParserError, KeyError, ArgumentError].freeze

  retry_on(*RETRYABLE_ERRORS, wait: :exponentially_longer, attempts: 3) do |job, error|
    reason = job.arguments.first.is_a?(Hash) ? (job.arguments.first["reason"] || job.arguments.first[:reason]) : nil
    record_failure!(error, reason: reason)
    finish_and_enqueue_pending
  end

  def self.enqueue(reason:, active_conversation_id: nil)
    unless Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)
      Rails.cache.write(
        PENDING_KEY,
        { "reason" => reason, "active_conversation_id" => active_conversation_id },
        expires_in: LOCK_TTL * 2
      )
      return false
    end

    perform_later(reason: reason, active_conversation_id: active_conversation_id)
    true
  rescue ActiveJob::EnqueueError
    finish_and_enqueue_pending
    raise
  end

  def self.record_failure!(error, reason: nil)
    Surface.create!(
      status: "invalid",
      composition_version: "flyd-1",
      generated_at: Time.current,
      metadata: {
        "composition_reason" => reason,
        "invalid_reason" => error.message,
        "error_class" => error.class.name
      }.compact
    )
  end

  def self.finish_and_enqueue_pending
    Rails.cache.delete(LOCK_KEY)
    pending = Rails.cache.read(PENDING_KEY)
    Rails.cache.delete(PENDING_KEY)
    return unless pending

    enqueue(
      reason: pending["reason"] || pending[:reason] || "coalesced_update",
      active_conversation_id: pending["active_conversation_id"] || pending[:active_conversation_id]
    )
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

    BroadcastSurfaceJob.perform_later(surface.id)
    self.class.finish_and_enqueue_pending
  rescue *RETRYABLE_ERRORS => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    raise
  rescue StandardError => error
    if draft&.persisted? && draft.status == "draft"
      draft.invalidate!(reason: error.message)
    else
      self.class.record_failure!(error, reason: reason)
    end
    self.class.finish_and_enqueue_pending
    raise
  end
end
