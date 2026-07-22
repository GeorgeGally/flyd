require "test_helper"

class RefreshWebDiscoveryJobTest < ActiveJob::TestCase
  setup do
    Rails.cache.delete(RefreshWebDiscoveryJob::LOCK_KEY) if defined?(RefreshWebDiscoveryJob::LOCK_KEY)
  end

  test "persists only Flyd-curated stories and queues composition" do
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
    client = Struct.new(:stories) { def fetch = stories }.new([ story ])
    feed_story = {
      id: "feed-7",
      title: "Personal intelligence through spatial interfaces",
      url: "https://journal.example/spatial",
      author: "editor",
      score: 80,
      published_at: 30.minutes.ago,
      description: "A detailed look at spatial interfaces for personal intelligence.",
      source_name: "Design Journal",
      source_key: "design-journal",
      source_kind: "publisher",
      source_category: "design"
    }
    feed_client = Struct.new(:stories) { def fetch = stories }.new([ feed_story ])
    skipped_story = {
      id: "feed-8", title: "A routine phone refresh", url: "https://journal.example/phone",
      score: 70, published_at: 20.minutes.ago, description: "A routine consumer product update.",
      source_name: "Design Journal", source_key: "design-journal", source_kind: "publisher", source_category: "design"
    }
    feed_client.stories << skipped_story
    candidate_pool = Struct.new(:stories) { def call = stories }.new([ story, feed_story, skipped_story ])
    taste_curator = Struct.new(:stories) { def call = stories }.new([
      story.merge(
        interest_verdict: "hot", interest_reason: "A novel personal intelligence interface.", rabbit_hole: true
      ),
      feed_story.merge(
        interest_verdict: "worth_a_look", interest_reason: "A spatial interaction deep dive.", rabbit_hole: false
      )
    ])
    metadata_client = Struct.new(:result) do
      def fetch(_url) = result
    end.new({
      description: "A concrete account of how personal intelligence interfaces work.",
      image_url: "https://example.com/story.jpg",
      site_name: "Example Journal"
    })
    job = RefreshWebDiscoveryJob.new
    job.define_singleton_method(:client) { client }
    job.define_singleton_method(:feed_client) { feed_client }
    job.define_singleton_method(:candidate_pool) { |_stories| candidate_pool }
    job.define_singleton_method(:taste_curator) { |_stories| taste_curator }
    job.define_singleton_method(:metadata_client) { metadata_client }
    compose_calls = []

    ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { compose_calls << arguments }) do
      job.perform
    end

    assert_equal [ { reason: "web_discovery_refresh" } ], compose_calls
    snapshot = IntelligenceState::WebDiscoveryProvider.new.snapshot
    assert_equal 2, snapshot.data[:discoveries].length
    evidence = snapshot.data[:discoveries].find { |item| item["id"] == "discovery:hn:42" }
    assert_equal "discovery:hn:42", evidence["id"]
    assert_equal "https://example.com/story", evidence.dig("content", "url")
    assert_equal "A concrete account of how personal intelligence interfaces work.", evidence.dig("content", "description")
    assert_equal "https://example.com/story.jpg", evidence.dig("content", "imageUrl")
    assert_equal "Example Journal", evidence.dig("content", "siteName")
    assert_equal "hot", evidence.dig("content", "interestVerdict")
    assert_equal "A novel personal intelligence interface.", evidence.dig("content", "interestReason")
    assert_equal true, evidence.dig("content", "rabbitHole")
    assert_equal 0.9, evidence["confidence"]
    feed_evidence = snapshot.data[:discoveries].find { |item| item["id"] == "discovery:design-journal:feed-7" }
    assert_equal "web.design-journal", feed_evidence["source"]
    assert_equal "Design Journal", feed_evidence.dig("content", "sourceName")
    assert_equal "publisher", feed_evidence.dig("content", "sourceKind")
    assert_nil snapshot.data[:discoveries].find { |item| item["id"] == "discovery:design-journal:feed-8" }
  end

  test "curation failure preserves the last usable discovery snapshot" do
    provider = IntelligenceState::WebDiscoveryProvider.new
    usable, = provider.persist!(discoveries: [ existing_discovery ])
    client = Struct.new(:stories) { def fetch = stories }.new([])
    candidate_pool = Struct.new(:stories) { def call = stories }.new([ {
      id: 9, title: "Raw story", url: "https://example.com/raw", published_at: 1.hour.ago
    } ])
    curator = Object.new
    curator.define_singleton_method(:call) { raise Flyd::TasteCurator::ValidationError, "evasive judgment" }
    job = RefreshWebDiscoveryJob.new
    job.define_singleton_method(:client) { client }
    job.define_singleton_method(:feed_client) { client }
    job.define_singleton_method(:candidate_pool) { |_stories| candidate_pool }
    job.define_singleton_method(:taste_curator) { |_stories| curator }

    assert_raises(Flyd::TasteCurator::ValidationError) { job.perform }

    assert_equal usable.id, provider.snapshot.snapshot_id
    assert_equal "Existing curated story", provider.snapshot.data[:discoveries].first.dig("content", "title")
  end


  test "enqueue coalesces repeated refresh requests" do
    assert RefreshWebDiscoveryJob.enqueue
    assert_not RefreshWebDiscoveryJob.enqueue
    assert_enqueued_jobs 1, only: RefreshWebDiscoveryJob
  end

  test "scheduled intelligence refresh queues CLI, personal context, and web providers" do
    Rails.cache.delete(RefreshIntelligenceStateJob::LOCK_KEY)
    Rails.cache.delete(RefreshPersonalContextJob::LOCK_KEY) if defined?(RefreshPersonalContextJob::LOCK_KEY)
    Rails.cache.delete(RefreshWebDiscoveryJob::LOCK_KEY) if defined?(RefreshWebDiscoveryJob::LOCK_KEY)
    Rails.cache.delete(RefreshLast30DaysReportsJob::LOCK_KEY) if defined?(RefreshLast30DaysReportsJob::LOCK_KEY)

    assert_enqueued_jobs 1, only: RefreshIntelligenceStateJob do
      assert_enqueued_jobs 1, only: RefreshPersonalContextJob do
        assert_enqueued_jobs 1, only: RefreshWebDiscoveryJob do
          assert_enqueued_jobs 1, only: RefreshLast30DaysReportsJob do
            ScheduleIntelligenceRefreshJob.perform_now
          end
        end
      end
    end
  end

  private

  def existing_discovery
    {
      "id" => "discovery:feed:existing", "type" => "discovery", "source" => "web.feed",
      "epistemicStatus" => "observation", "confidence" => 0.9, "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [], "content" => {
        "title" => "Existing curated story", "url" => "https://example.com/existing",
        "description" => "A previously curated story remains usable when new judgment fails."
      }
    }
  end
end
