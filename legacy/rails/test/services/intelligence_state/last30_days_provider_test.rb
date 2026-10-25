require "test_helper"

class IntelligenceState::Last30DaysProviderTest < ActiveSupport::TestCase
  test "persists and reads report evidence" do
    provider = IntelligenceState::Last30DaysProvider.new
    record, changed = provider.persist!(reports: [ report_evidence ])
    snapshot = provider.snapshot

    assert changed
    assert_equal record.id, snapshot.snapshot_id
    assert snapshot.fresh
    assert_empty snapshot.errors
    assert_equal "Last 30 days: AI agents", snapshot.data[:reports].first.dig("content", "title")
  end

  test "retains usable reports while exposing a later refresh failure" do
    provider = IntelligenceState::Last30DaysProvider.new
    usable, = provider.persist!(reports: [ report_evidence ])
    provider.record_failure!(RuntimeError.new("last30days reports unavailable"))

    snapshot = provider.snapshot

    assert snapshot.fresh
    assert_equal usable.id, snapshot.snapshot_id
    assert_equal [ "last30days reports unavailable" ], snapshot.errors
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
