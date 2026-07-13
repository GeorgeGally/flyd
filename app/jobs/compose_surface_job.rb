class ComposeSurfaceJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "surface:composition_enqueued"
  PENDING_KEY = "surface:composition_pending"
  LOCK_TTL = 5.minutes
  RETRYABLE_ERRORS = [
    Llm::Chat::Error,
    JSON::ParserError,
    KeyError,
    ArgumentError,
    Flyd::StateBudget::BudgetExceeded,
    Flyd::SurfacePlanValidator::ValidationError
  ].freeze

  retry_on(*RETRYABLE_ERRORS, wait: :exponentially_longer, attempts: 3) do |job, error|
    arguments = job.arguments.first.is_a?(Hash) ? job.arguments.first : {}
    record_failure!(error, reason: arguments["reason"] || arguments[:reason])
    finish_and_enqueue_pending
  end

  def self.enqueue(reason:, active_conversation_id: nil, active_intent_id: nil)
    payload = {
      "reason" => reason,
      "active_conversation_id" => active_conversation_id,
      "active_intent_id" => active_intent_id
    }

    unless Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)
      Rails.cache.write(PENDING_KEY, payload, expires_in: LOCK_TTL * 2)
      return false
    end

    perform_later(**payload.symbolize_keys)
    true
  rescue ActiveJob::EnqueueError
    finish_and_enqueue_pending
    raise
  end

  def self.record_failure!(error, reason: nil)
    SurfaceCompositionLog.create!(
      reason: reason,
      status: "failed",
      validation_errors: [ error.message ],
      metadata: { "error_class" => error.class.name }
    )
  end

  def self.finish_and_enqueue_pending
    Rails.cache.delete(LOCK_KEY)
    pending = Rails.cache.read(PENDING_KEY)
    Rails.cache.delete(PENDING_KEY)
    return unless pending

    enqueue(
      reason: pending["reason"] || pending[:reason] || "coalesced_update",
      active_conversation_id: pending["active_conversation_id"] || pending[:active_conversation_id],
      active_intent_id: pending["active_intent_id"] || pending[:active_intent_id]
    )
  end

  def perform(reason:, active_conversation_id: nil, active_intent_id: nil)
    conversation = Conversation.includes(:messages, :project, :context).find_by(id: active_conversation_id)
    intent = Intent.find_by(id: active_intent_id)
    intelligence = Flyd::Intelligence.new(active_conversation: conversation, active_intent: intent, fallback: false)
    plan = intelligence.compose_surface
    digest = intelligence.diagnostics.fetch(:state_digest)
    provider_snapshots = intelligence.diagnostics[:provider_snapshots] || []
    draft = Surfaces::PersistPlan.call(
      plan: plan,
      source_state_digest: digest,
      composition_version: "flyd-4",
      active_conversation: conversation,
      active_intent: intent
    )
    draft.update!(
      metadata: draft.metadata.merge(
        "composition_reason" => reason,
        "surface_mode" => plan.surface_mode,
        "provider_snapshots" => provider_snapshots,
        "active_conversation_id" => conversation&.id
      )
    )
    surface = Surface.activate!(draft)
    intent.resolve!(surface: surface) if intent && intent.status != "clarification_required"

    log = SurfaceCompositionLog.create!(
      surface: surface,
      reason: reason,
      state_digest: digest,
      status: "succeeded",
      input_characters: intelligence.diagnostics[:input_characters],
      output_characters: intelligence.diagnostics[:output_characters],
      latency_ms: intelligence.diagnostics[:latency_ms],
      provider_health: provider_snapshots,
      metadata: { "dropped" => intelligence.diagnostics[:dropped] || [] }
    )

    enqueue_broadcast(surface, log)
    self.class.finish_and_enqueue_pending
  rescue *RETRYABLE_ERRORS => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    raise
  rescue StandardError => error
    draft&.invalidate!(reason: error.message) if draft&.persisted? && draft.status == "draft"
    self.class.record_failure!(error, reason: reason)
    self.class.finish_and_enqueue_pending
    raise
  end

  private

  def enqueue_broadcast(surface, log)
    BroadcastSurfaceJob.perform_later(surface.id)
  rescue ActiveJob::EnqueueError => error
    log.update!(metadata: log.metadata.merge("broadcast_enqueue_error" => error.message))
    Rails.logger.error("Surface #{surface.id} activated but broadcast enqueue failed: #{error.message}")
  end
end
