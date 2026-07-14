require "test_helper"

class SurfaceItemSourcesControllerTest < ActionDispatch::IntegrationTest
  test "shows readable evidence and the exact external source" do
    snapshot, = IntelligenceState::WebDiscoveryProvider.new.persist!(discoveries: [ discovery ])
    surface = Surface.create!(
      status: "draft",
      focus_item_key: "discovery:42",
      composition_version: "test",
      metadata: { "provider_snapshots" => [ { "source" => "web-discovery", "snapshot_id" => snapshot.id } ] }
    )
    item = surface.items.create!(
      item_key: "discovery:42", kind: "insight", intent: "inform", renderer: "discovery_scene",
      depth: "foreground", state: "presented", position: 0, title: "Current story",
      source_refs: [ { "type" => "discovery", "id" => "discovery:hn:42" } ]
    )

    get surface_item_sources_path(item)

    assert_response :success
    assert_select "h2", text: "Current story"
    assert_select "a[href='https://example.com/story']", text: "Read original"
    assert_select "a[href='https://news.ycombinator.com/item?id=42']", text: "Discussion"
  end

  private

  def discovery
    {
      "id" => "discovery:hn:42", "type" => "discovery", "source" => "web.hacker_news",
      "epistemicStatus" => "observation", "confidence" => 0.8, "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => "Current story", "url" => "https://example.com/story",
        "discussionUrl" => "https://news.ycombinator.com/item?id=42", "sourceName" => "Hacker News"
      }
    }
  end
end
