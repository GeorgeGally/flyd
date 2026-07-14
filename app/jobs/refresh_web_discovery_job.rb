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
    selected = WebDiscovery::TopicProfile.new(cli_snapshot).select(client.fetch, limit: 8)
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

  def cli_snapshot
    IntelligenceState::CliProvider.new.snapshot
  end

  def provider
    @provider ||= IntelligenceState::WebDiscoveryProvider.new
  end

  def evidence_for(story)
    {
      "id" => "discovery:hn:#{story.fetch(:id)}",
      "type" => "discovery",
      "source" => "web.hacker_news",
      "epistemicStatus" => "observation",
      "confidence" => story[:matched_topics].any? ? 0.85 : 0.75,
      "generatedAt" => story.fetch(:published_at).iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => story.fetch(:title),
        "url" => story.fetch(:url),
        "discussionUrl" => story.fetch(:discussion_url),
        "sourceName" => "Hacker News",
        "author" => story[:author],
        "score" => story[:score],
        "comments" => story[:comments],
        "publishedAt" => story.fetch(:published_at).iso8601,
        "matchedTopics" => story[:matched_topics],
        "relevanceReason" => story[:relevance_reason]
      }
    }
  end
end
