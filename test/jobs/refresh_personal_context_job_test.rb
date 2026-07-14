require "test_helper"

class RefreshPersonalContextJobTest < ActiveJob::TestCase
  setup do
    Rails.cache.delete(RefreshPersonalContextJob::LOCK_KEY) if defined?(RefreshPersonalContextJob::LOCK_KEY)
  end

  test "persists recent work and today's horoscope then queues composition" do
    scanner = Struct.new(:items) { def fetch = items }.new([ {
      name: "flyd",
      path: "/Users/test/Documents/flyd",
      branch: "main",
      summary: "Build the living stage",
      updated_at: Time.current
    } ])
    horoscope = Struct.new(:item) { def fetch = item }.new({
      sign: "Aries",
      date: Date.current,
      description: "Make room for a creative risk today.",
      author: "Astrologer",
      url: "https://www.astrology.com/horoscope/daily/aries.html"
    })
    job = RefreshPersonalContextJob.new
    job.define_singleton_method(:scanner) { scanner }
    job.define_singleton_method(:horoscope_client) { horoscope }
    calls = []

    ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { calls << arguments }) do
      job.perform
    end

    snapshot = IntelligenceState::PersonalContextProvider.new.snapshot
    assert_equal "Continue Flyd", snapshot.data[:activities].first.dig("content", "title")
    assert_equal "Aries", snapshot.data[:horoscopes].first.dig("content", "title")
    assert_equal [ { reason: "personal_context_refresh" } ], calls
  end
end
