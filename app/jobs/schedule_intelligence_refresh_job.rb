class ScheduleIntelligenceRefreshJob < ApplicationJob
  queue_as :default

  def perform
    RefreshIntelligenceStateJob.enqueue
  end
end
