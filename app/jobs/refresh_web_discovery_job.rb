class RefreshWebDiscoveryJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "web_discovery:refresh_enqueued"
  LOCK_TTL = 30.minutes

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def self.enqueue
    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::WebDiscoveryProvider::PROVIDER)
    return false if snapshot&.fresh?
    return false unless Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)

    perform_later
    true
  rescue ActiveJob::EnqueueError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  def perform
    stories = candidate_pool(client.fetch + feed_client.fetch).call
    selected = taste_curator(stories).call
    selected = selected.map { |story| story.merge(metadata_client.fetch(story.fetch(:url))) }
    _record, changed = provider.persist!(discoveries: selected.map { |story| evidence_for(story) })
    ComposeSurfaceJob.enqueue(reason: "web_discovery_refresh") if changed || Surface.current.nil? || Surface.current.stale?
    Rails.cache.delete(LOCK_KEY)
  rescue StandardError => error
    provider.record_failure!(error)
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  private

  def client
    @client ||= WebDiscovery::HackerNewsClient.new
  end

  def feed_client
    @feed_client ||= WebDiscovery::FeedClient.new
  end

  def cli_snapshot
    IntelligenceState::CliProvider.new.snapshot
  end

  def personal_snapshot
    IntelligenceState::PersonalContextProvider.new.snapshot
  end

  def candidate_pool(stories)
    WebDiscovery::CandidatePool.new(stories)
  end

  def taste_curator(stories)
    Flyd::TasteCurator.new(
      stories: stories,
      context: { cli: cli_snapshot.data, personal: personal_snapshot.data }
    )
  end

  def provider
    @provider ||= IntelligenceState::WebDiscoveryProvider.new
  end

  def metadata_client
    @metadata_client ||= WebDiscovery::PageMetadata.new
  end

  def evidence_for(story)
    source_key = story[:source_key].presence || "hn"
    source_name = story[:source_name].presence || "Hacker News"
    {
      "id" => "discovery:#{source_key}:#{story.fetch(:id)}",
      "type" => "discovery",
      "source" => "web.#{source_key}",
      "epistemicStatus" => "observation",
      "confidence" => story.fetch(:interest_verdict) == "hot" ? 0.9 : 0.82,
      "generatedAt" => story.fetch(:published_at).iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => story.fetch(:title),
        "url" => story.fetch(:url),
        "discussionUrl" => story[:discussion_url],
        "sourceName" => source_name,
        "sourceKind" => story[:source_kind],
        "sourceCategory" => story[:source_category],
        "author" => story[:author],
        "score" => story[:score],
        "comments" => story[:comments],
        "publishedAt" => story.fetch(:published_at).iso8601,
        "interestVerdict" => story.fetch(:interest_verdict),
        "interestReason" => story.fetch(:interest_reason),
        "rabbitHole" => story.fetch(:rabbit_hole),
        "description" => story[:description],
        "imageUrl" => story[:image_url],
        "siteName" => story[:site_name]
      }.compact
    }
  end
end
