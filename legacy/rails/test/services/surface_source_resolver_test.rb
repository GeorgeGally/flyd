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
    assert_equal "Original story", source.title
    assert_equal "https://example.com/original", source.url
    assert_equal "https://news.ycombinator.com/item?id=42", source.discussion_url
    assert_equal "A grounded summary.", source.description
    assert_equal "https://example.com/preview.jpg", source.image_url
    assert_equal "Example", source.site_name
  end

  test "rejects unsafe external schemes" do
    record, = IntelligenceState::WebDiscoveryProvider.new.persist!(
      discoveries: [ discovery("Unsafe", "javascript:alert(1)") ]
    )
    source = SurfaceSourceResolver.new(create_surface(record.id)).resolve(type: "discovery", id: "discovery:hn:42")

    assert_nil source.url
  end

  test "resolves a readable exact excerpt from a personal archive snapshot" do
    payload = {
      "reports" => [ {
        "id" => "report:research",
        "type" => "report",
        "content" => {
          "title" => "Research Before Planning",
          "excerpt" => "# Research Before Planning\n\nCurrent community evidence should ground decisions before implementation."
        }
      } ]
    }
    snapshot = IntelligenceSnapshot.create!(
      provider: "flyd-cli",
      schema_version: "1.0",
      status: "fresh",
      state_digest: IntelligenceSnapshot.digest_for(payload),
      generated_at: Time.current,
      received_at: Time.current,
      fresh_until: 1.hour.from_now,
      payload: payload,
      provider_errors: []
    )
    surface = create_surface(snapshot.id, source: "flyd-cli")

    source = SurfaceSourceResolver.new(surface).resolve(type: "report", id: "report:research")

    assert_equal "Research Before Planning", source.title
    assert_equal "Research Before Planning Current community evidence should ground decisions before implementation.", source.description
  end

  private

  def create_surface(snapshot_id, source: "web-discovery")
    Surface.create!(
      status: "draft",
      focus_item_key: "discovery:42",
      composition_version: "test",
      metadata: {
        "provider_snapshots" => [ { "source" => source, "snapshot_id" => snapshot_id } ]
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
        "sourceName" => "Hacker News",
        "siteName" => "Example",
        "description" => "A grounded summary.",
        "imageUrl" => "https://example.com/preview.jpg"
      }
    }
  end
end
