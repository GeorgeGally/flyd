class ScheduleIntelligenceRefreshJob < ApplicationJob
  queue_as :default

  def perform
    RefreshIntelligenceStateJob.enqueue
    RefreshWebDiscoveryJob.enqueue if web_discovery_enabled?
  end

  private

  def web_discovery_enabled?
    Rails.application.config_for(:flyd).fetch(:web_discovery_enabled, true)
  end
end
