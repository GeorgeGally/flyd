class ArchiveEventJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def perform(attributes)
    attributes = attributes.to_h.symbolize_keys.slice(
      :event_key, :body, :event_type, :outcome, :signal,
      :project, :record_type, :record_id, :timestamp
    )
    attributes[:timestamp] = Time.zone.parse(attributes[:timestamp]) if attributes[:timestamp].is_a?(String)

    Flyd::ArchiveEventWriter.new.write!(**attributes)
    RefreshIntelligenceStateJob.enqueue
  end
end
