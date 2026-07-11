class ComposeSurfaceJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "surface:composition_enqueued"
  LOCK_TTL = 5.minutes
  RETRYABLE_ERRORS = [Llm::Chat::Error, JSON::ParserError, KeyError, ArgumentError].freeze

  retry_on(*RETRYABLE_ERRORS, wait: :exponentially_longer, attempts: 3) do |job, error|
    reason = job.arguments.first.is_a?(Hash) ? (job.arguments.first["reason"] || job.arguments.first[:reason]) : nil
    record_failure!(error, reason: reason)
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
    Rails.cache.delete(LOCK_KEY)
  rescue *RETRYABLE_ERRORS => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    raise
  rescue StandardError => error
    if draft&.persisted? && draft.status == "draft"
      draft.invalidate!(reason: error.message)
    else
      self.class.record_failure!(error, reason: reason)
    end
    Rails.cache.delete(LOCK_KEY)
    raise
  end
end
