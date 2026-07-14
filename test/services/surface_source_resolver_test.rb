require "test_helper"

class SurfaceSourceResolverTest < ActiveSupport::TestCase
  test "resolves only the exact provider snapshot recorded on the surface" do
    first, = IntelligenceState::WebDiscoveryProvider.new.persist!(
      discoveries: [ discovery("Original story", "https://example.com/original") ],
      generated_at: 1.minute.ago
    )
    IntelligenceState::WebDiscoveryProvider.new.persist!(
      discoveries: [ discovery("Replacement story", "https://example.com/replacement") ],
      generated_at: Time.current
    )
    surface = create_surface(first.id)

    source = SurfaceSourceResolver.new(surface).resolve(type: "discovery", id: "discovery:hn:42")

    assert_equal "Original story", source.record.dig("content", "title")
    assert_equal "https://example.com/original", source.url
    assert_equal "https://news.ycombinator.com/item?id=42", source.discussion_url
  end

  test "rejects unsafe external schemes" do
    record, = IntelligenceState::WebDiscoveryProvider.new.persist!(
      discoveries: [ discovery("Unsafe", "javascript:alert(1)") ]
    )
    source = SurfaceSourceResolver.new(create_surface(record.id)).resolve(type: "discovery", id: "discovery:hn:42")

    assert_nil source.url
  end

  private

  def create_surface(snapshot_id)
    Surface.create!(
      status: "draft",
      focus_item_key: "discovery:42",
      composition_version: "test",
      metadata: {
        "provider_snapshots" => [ { "source" => "web-discovery", "snapshot_id" => snapshot_id } ]
      }
    )
  end

  def discovery(title, url)
    {
      "id" => "discovery:hn:42",
      "type" => "discovery",
      "source" => "web.hacker_news",
      "epistemicStatus" => "observation",
      "confidence" => 0.8,
      "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => title,
        "url" => url,
        "discussionUrl" => "https://news.ycombinator.com/item?id=42",
        "sourceName" => "Hacker News"
      }
    }
  end
end
