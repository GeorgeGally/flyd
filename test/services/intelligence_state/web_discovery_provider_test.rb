require "test_helper"

class IntelligenceState::WebDiscoveryProviderTest < ActiveSupport::TestCase
  test "persists fresh discoveries and exposes a normalized snapshot" do
    provider = IntelligenceState::WebDiscoveryProvider.new
    record, changed = provider.persist!(discoveries: [ discovery ], generated_at: Time.current)

    snapshot = provider.snapshot

    assert changed
    assert_equal record.id, snapshot.snapshot_id
    assert snapshot.fresh
    assert_equal "discovery:hn:42", snapshot.data[:discoveries].first["id"]
  end

  test "preserves the last usable snapshot when refresh fails" do
    provider = IntelligenceState::WebDiscoveryProvider.new
    usable, = provider.persist!(discoveries: [ discovery ], generated_at: Time.current)
    provider.record_failure!(RuntimeError.new("news unavailable"))

    snapshot = provider.snapshot

    assert_equal usable.id, snapshot.snapshot_id
    assert_equal [ "news unavailable" ], snapshot.errors
  end

  test "registry exposes CLI and web providers together" do
    IntelligenceState::CliProvider.new.persist!({
      "version" => "1.0", "source" => "flyd-cli", "generatedAt" => Time.current.iso8601,
      "goals" => [], "tensions" => [], "signals" => [], "curiosity" => [], "nudges" => [], "reports" => [], "recentEvents" => []
    })
    IntelligenceState::WebDiscoveryProvider.new.persist!(discoveries: [ discovery ])

    sources = IntelligenceState::Registry.snapshot[:providers].map { |provider| provider[:source] }

    assert_equal [ "flyd-cli", "web-discovery" ], sources
  end

  private

  def discovery
    {
      "id" => "discovery:hn:42",
      "type" => "discovery",
      "source" => "web.hacker_news",
      "epistemicStatus" => "observation",
      "confidence" => 0.8,
      "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => "A useful current story",
        "url" => "https://example.com/story",
        "discussionUrl" => "https://news.ycombinator.com/item?id=42",
        "sourceName" => "Hacker News"
      }
    }
  end
end
