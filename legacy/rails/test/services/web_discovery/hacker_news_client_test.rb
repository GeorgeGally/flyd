require "test_helper"

class WebDiscovery::HackerNewsClientTest < ActiveSupport::TestCase
  test "fetches a bounded set of valid stories from fixed official endpoints" do
    calls = []
    responses = {
      "https://hacker-news.firebaseio.com/v0/topstories.json" => [ 42, 43, 44 ],
      "https://hacker-news.firebaseio.com/v0/item/42.json" => {
        "id" => 42, "type" => "story", "title" => "Current AI research", "url" => "https://example.com/research",
        "by" => "author", "score" => 120, "descendants" => 30, "time" => Time.current.to_i
      },
      "https://hacker-news.firebaseio.com/v0/item/43.json" => {
        "id" => 43, "type" => "job", "title" => "A job", "time" => Time.current.to_i
      }
    }
    transport = lambda do |uri, **|
      calls << uri.to_s
      responses[uri.to_s]
    end

    stories = WebDiscovery::HackerNewsClient.new(transport: transport, limit: 2).fetch

    assert_equal [ 42 ], stories.map { |story| story[:id] }
    assert_equal "https://example.com/research", stories.first[:url]
    assert_equal "https://news.ycombinator.com/item?id=42", stories.first[:discussion_url]
    assert_equal 3, calls.length
    assert calls.all? { |url| url.start_with?("https://hacker-news.firebaseio.com/v0/") }
  end
end
