class RefreshLast30DaysReportsJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "last30days_reports:refresh_enqueued"
  LOCK_TTL = 30.minutes

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def self.enqueue
    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::Last30DaysProvider::PROVIDER)
    return false if snapshot&.fresh?
    return false unless Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)

    perform_later
    true
  rescue ActiveJob::EnqueueError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  def perform
    _record, changed = provider.persist!(reports: scanner.fetch)
    ComposeSurfaceJob.enqueue(reason: "last30days_reports_refresh") if changed || Surface.current.nil? || Surface.current.stale?
    Rails.cache.delete(LOCK_KEY)
  rescue StandardError => error
    provider.record_failure!(error)
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  private

  def configuration
    @configuration ||= Rails.application.config_for(:flyd)
  end

  def scanner
    @scanner ||= Last30Days::ReportScanner.new(root: configuration.fetch(:last30days_report_directory))
  end

  def provider
    @provider ||= IntelligenceState::Last30DaysProvider.new
  end
end
