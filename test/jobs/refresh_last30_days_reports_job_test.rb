require "test_helper"

class RefreshLast30DaysReportsJobTest < ActiveJob::TestCase
  setup do
    Rails.cache.delete(RefreshLast30DaysReportsJob::LOCK_KEY) if defined?(RefreshLast30DaysReportsJob::LOCK_KEY)
  end

  test "persists scanned reports and queues composition" do
    scanner = Struct.new(:items) { def fetch = items }.new([ report_evidence ])
    job = RefreshLast30DaysReportsJob.new
    job.define_singleton_method(:scanner) { scanner }
    calls = []

    ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { calls << arguments }) do
      job.perform
    end

    snapshot = IntelligenceState::Last30DaysProvider.new.snapshot
    assert_equal "Last 30 days: AI agents", snapshot.data[:reports].first.dig("content", "title")
    assert_equal [ { reason: "last30days_reports_refresh" } ], calls
  end

  private

  def report_evidence
    {
      "id" => "report:last30days:ai-agents",
      "type" => "report",
      "source" => "last30days",
      "epistemicStatus" => "observation",
      "confidence" => 0.86,
      "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => "Last 30 days: AI agents",
        "excerpt" => "Developers are comparing agent reliability across tool loops.",
        "path" => "/tmp/ai-agents-raw.json"
      }
    }
  end
end
