require "test_helper"

class WebDiscovery::TopicProfileTest < ActiveSupport::TestCase
  test "ranks local-interest matches while retaining one serendipitous story" do
    snapshot = Struct.new(:data).new(
      {
        goals: [ { "content" => { "title" => "Ship Flyd personal intelligence" } } ],
        signals: [ { "content" => { "topic" => "data visualization" } } ],
        reports: [ { "content" => { "title" => "The planning command review" } } ], recent_events: []
      }
    )
    stories = [
      { id: 1, title: "Personal intelligence interfaces", score: 30 },
      { id: 2, title: "Data visualization without dashboards", score: 20 },
      { id: 3, title: "The command economy of a surprising materials discovery", score: 500 }
    ]

    selected = WebDiscovery::TopicProfile.new(snapshot).select(stories, limit: 3)

    assert_equal [ 1, 2, 3 ], selected.map { |story| story[:id] }
    assert_equal [ "intelligence", "personal" ], selected.first[:matched_topics].sort
    assert_equal "From today's top stories", selected.last[:relevance_reason]
  end

  test "does not flatten a meaningful phrase into a generic short-word match" do
    snapshot = Struct.new(:data).new(
      {
        goals: [],
        signals: [ { "content" => { "topic" => "generative art" } } ],
        reports: [],
        recent_events: [ { "content" => { "topics" => [ "art", "sound reactive" ] } } ]
      }
    )
    stories = [
      { id: 1, title: "Zero Knowledge Tolstoyan Art", score: 100 },
      { id: 2, title: "A new tool for generative art", score: 20 },
      { id: 3, title: "Sound reactive installations", score: 10 }
    ]

    selected = WebDiscovery::TopicProfile.new(snapshot).select(stories, limit: 3)

    assert_equal [ 2, 3, 1 ], selected.map { |story| story[:id] }
    assert_equal [ "generative art" ], selected.first[:matched_topics]
    assert_equal [ "sound reactive" ], selected.second[:matched_topics]
    assert_empty selected.last[:matched_topics]
  end

  test "diversifies selected stories across sources before repeating one source" do
    snapshot = Struct.new(:data).new({ goals: [], signals: [], reports: [], recent_events: [] })
    stories = [
      { id: 1, title: "First", score: 100, source_key: "alpha" },
      { id: 2, title: "Second", score: 99, source_key: "alpha" },
      { id: 3, title: "Third", score: 20, source_key: "beta" }
    ]

    selected = WebDiscovery::TopicProfile.new(snapshot).select(stories, limit: 2)

    assert_equal [ 1, 3 ], selected.pluck(:id)
  end
end
