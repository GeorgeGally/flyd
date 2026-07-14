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
    assert_equal "Serendipity from today's top stories", selected.last[:relevance_reason]
  end
end
