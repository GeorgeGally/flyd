class ScheduleIntelligenceRefreshJob < ApplicationJob
  queue_as :default

  def perform
    RefreshIntelligenceStateJob.enqueue
    RefreshPersonalContextJob.enqueue if personal_context_enabled?
    RefreshWebDiscoveryJob.enqueue if web_discovery_enabled?
    RefreshLast30DaysReportsJob.enqueue if last30days_reports_enabled?
  end

  private

  def web_discovery_enabled?
    Rails.application.config_for(:flyd).fetch(:web_discovery_enabled, true)
  end

  def personal_context_enabled?
    Rails.application.config_for(:flyd).fetch(:personal_context_enabled, true)
  end

  def last30days_reports_enabled?
    Rails.application.config_for(:flyd).fetch(:last30days_reports_enabled, true)
  end
end
