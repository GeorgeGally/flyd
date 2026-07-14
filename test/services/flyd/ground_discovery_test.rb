require "test_helper"

class Flyd::GroundDiscoveryTest < ActiveSupport::TestCase
  test "replaces model filler with exact current-story evidence" do
    result = Flyd::GroundDiscovery.call(
      payload: discovery_payload(
        title: "A generic rewrite",
        summary: "This article discusses useful applications.",
        source_ref: { type: "discovery", id: "discovery:hn:42" }
      ),
      state: provider_state(
        type: "discovery",
        id: "discovery:hn:42",
        content: {
          title: "The git history command",
          sourceName: "Hacker News",
          score: 292,
          comments: 169,
          publishedAt: "2026-07-14T00:57:11Z",
          matchedTopics: [ "git" ],
          relevanceReason: "Matches your interests: git"
        }
      )
    )

    item = result["items"].first
    assert_equal "The git history command", item["title"]
    assert_equal "292 points · 169 comments · Published 14 Jul 2026", item["summary"]
    assert_equal "Matches your interests: git", item.dig("metadata", "why_it_matters")
    assert_equal "Current story · Hacker News", item.dig("metadata", "source_label")
  end

  test "uses the exact readable excerpt for archive discovery" do
    result = Flyd::GroundDiscovery.call(
      payload: discovery_payload(
        title: "Invented title",
        summary: "Invented summary",
        source_ref: { type: "report", id: "report:research" }
      ),
      state: provider_state(
        type: "report",
        id: "report:research",
        content: {
          title: "Research Before Planning",
          excerpt: "# Research Before Planning\n\nCurrent community evidence should ground decisions before implementation."
        }
      )
    )

    item = result["items"].first
    assert_equal "Research Before Planning", item["title"]
    assert_equal "Research Before Planning Current community evidence should ground decisions before implementation.", item["summary"]
    assert_equal "From your archive", item.dig("metadata", "source_label")
  end

  test "uses the director's selected evidence instead of an unrelated model choice" do
    state = provider_state(
      type: "discovery",
      id: "discovery:hn:art",
      content: {
        title: "Zero Knowledge Tolstoyan Art",
        sourceName: "Hacker News",
        score: 16,
        comments: 5,
        publishedAt: "2026-07-11T15:38:13Z",
        relevanceReason: "Matches your interests: art"
      }
    )
    state[:interface_direction] = {
      candidates: [ {
        mode: "discovery",
        evidence_refs: [ { type: "discovery", id: "discovery:hn:art" } ]
      } ]
    }
    payload = discovery_payload(
      title: "Unrelated model choice",
      summary: "Generic filler",
      source_ref: { type: "discovery", id: "discovery:hn:other" }
    )

    result = Flyd::GroundDiscovery.call(payload: payload, state: state)

    item = result["items"].first
    assert_equal [ { "type" => "discovery", "id" => "discovery:hn:art" } ], item["source_refs"]
    assert_equal "Zero Knowledge Tolstoyan Art", item["title"]
    assert_equal "A current story matches your interests: art.", result["understanding"]
  end

  private

  def discovery_payload(title:, summary:, source_ref:)
    {
      surface_mode: "discovery",
      focus_item_id: "discovery:item",
      items: [ {
        id: "discovery:item",
        title: title,
        summary: summary,
        source_refs: [ source_ref ],
        metadata: { why_it_matters: "Model rationale", source_label: "Model label" }
      } ]
    }
  end

  def provider_state(type:, id:, content:)
    {
      provider_state: {
        providers: [ {
          data: {
            evidence: [ { id: id, type: type, content: content } ]
          }
        } ]
      }
    }
  end
end
