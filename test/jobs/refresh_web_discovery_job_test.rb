require "test_helper"

class RefreshWebDiscoveryJobTest < ActiveJob::TestCase
  setup do
    Rails.cache.delete(RefreshWebDiscoveryJob::LOCK_KEY) if defined?(RefreshWebDiscoveryJob::LOCK_KEY)
  end

  test "persists ranked current stories and queues composition" do
    story = {
      id: 42,
      title: "Personal intelligence interfaces",
      url: "https://example.com/story",
      discussion_url: "https://news.ycombinator.com/item?id=42",
      author: "author",
      score: 100,
      comments: 20,
      published_at: 1.hour.ago
    }
    cli_snapshot = Struct.new(:data).new(
      { goals: [ { "content" => { "title" => "Build personal intelligence" } } ] }
    )
    client = Struct.new(:stories) { def fetch = stories }.new([ story ])
    job = RefreshWebDiscoveryJob.new
    job.define_singleton_method(:client) { client }
    job.define_singleton_method(:cli_snapshot) { cli_snapshot }
    compose_calls = []

    ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { compose_calls << arguments }) do
      job.perform
    end

    assert_equal [ { reason: "web_discovery_refresh" } ], compose_calls
    snapshot = IntelligenceState::WebDiscoveryProvider.new.snapshot
    evidence = snapshot.data[:discoveries].first
    assert_equal "discovery:hn:42", evidence["id"]
    assert_equal [ "intelligence", "personal" ], evidence.dig("content", "matchedTopics").sort
    assert_equal "https://example.com/story", evidence.dig("content", "url")
  end


  test "enqueue coalesces repeated refresh requests" do
    assert RefreshWebDiscoveryJob.enqueue
    assert_not RefreshWebDiscoveryJob.enqueue
    assert_enqueued_jobs 1, only: RefreshWebDiscoveryJob
  end

  test "scheduled intelligence refresh queues CLI and web providers" do
    Rails.cache.delete(RefreshIntelligenceStateJob::LOCK_KEY)
    Rails.cache.delete(RefreshWebDiscoveryJob::LOCK_KEY) if defined?(RefreshWebDiscoveryJob::LOCK_KEY)

    assert_enqueued_jobs 1, only: RefreshIntelligenceStateJob do
      assert_enqueued_jobs 1, only: RefreshWebDiscoveryJob do
        ScheduleIntelligenceRefreshJob.perform_now
      end
    end
  end
end
