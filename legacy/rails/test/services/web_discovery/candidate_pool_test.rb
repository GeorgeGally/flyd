require "test_helper"

class WebDiscovery::CandidatePoolTest < ActiveSupport::TestCase
  test "removes stale invalid and duplicate stories without applying taste" do
    now = Time.zone.parse("2026-07-15 10:00:00")
    stories = [
      story(1, "A strange machine", "https://example.com/machine", now - 1.hour, score: 20),
      story(2, "A STRANGE machine!", "https://mirror.example/machine", now - 2.hours, score: 100),
      story(3, "Duplicate URL", "https://example.com/machine#discussion", now - 3.hours, score: 90),
      story(4, "Too old", "https://example.com/old", now - 8.days, score: 500),
      story(5, "Unsafe", "file:///tmp/story", now - 1.hour, score: 500),
      story(nil, "Missing ID", "https://example.com/missing", now - 1.hour, score: 500),
      story(6, "Consumer gadget launch", "https://example.com/gadget", now - 4.hours, score: 10)
    ]

    selected = WebDiscovery::CandidatePool.new(stories, now:).call

    assert_equal [ 1, 6 ], selected.pluck(:id)
  end

  test "diversifies sources before repeats and respects the batch limit" do
    now = Time.zone.parse("2026-07-15 10:00:00")
    stories = [
      story(1, "Alpha one", "https://alpha.example/one", now - 1.hour, source_key: "alpha", score: 100),
      story(2, "Alpha two", "https://alpha.example/two", now - 2.hours, source_key: "alpha", score: 99),
      story(3, "Beta one", "https://beta.example/one", now - 3.hours, source_key: "beta", score: 20),
      story(4, "Gamma one", "https://gamma.example/one", now - 4.hours, source_key: "gamma", score: 10)
    ]

    selected = WebDiscovery::CandidatePool.new(stories, limit: 3, now:).call

    assert_equal [ 1, 3, 4 ], selected.pluck(:id)
  end

  private

  def story(id, title, url, published_at, source_key: "source", score: 0)
    { id:, title:, url:, published_at:, source_key:, score: }
  end
end
