require "digest"

class RefreshPersonalContextJob < ApplicationJob
  queue_as :default

  LOCK_KEY = "personal_context:refresh_enqueued"
  LOCK_TTL = 30.minutes

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def self.enqueue
    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::PersonalContextProvider::PROVIDER)
    return false if snapshot&.fresh?
    return false unless Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)

    perform_later
    true
  rescue ActiveJob::EnqueueError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  def perform
    activities = scanner.fetch.map { |activity| activity_evidence(activity) }
    horoscope = horoscope_client.fetch
    horoscopes = horoscope ? [ horoscope_evidence(horoscope) ] : []
    _record, changed = provider.persist!(activities:, horoscopes:)
    ComposeSurfaceJob.enqueue(reason: "personal_context_refresh") if changed || Surface.current.nil? || Surface.current.stale?
    Rails.cache.delete(LOCK_KEY)
  rescue StandardError => error
    provider.record_failure!(error)
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  private

  def configuration
    @configuration ||= Rails.application.config_for(:flyd)
  end

  def scanner
    @scanner ||= LocalActivity::Scanner.new(root: configuration.fetch(:local_activity_root))
  end

  def horoscope_client
    @horoscope_client ||= Horoscope::Client.new(sign: configuration.fetch(:zodiac_sign))
  end

  def provider
    @provider ||= IntelligenceState::PersonalContextProvider.new
  end

  def activity_evidence(activity)
    updated_at = activity.fetch(:updated_at)
    project_name = activity.fetch(:name).to_s.humanize
    {
      "id" => "activity:#{Digest::SHA256.hexdigest(activity.fetch(:path)).first(16)}",
      "type" => "activity",
      "source" => "local.activity",
      "epistemicStatus" => "observation",
      "confidence" => 0.95,
      "generatedAt" => updated_at.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => "Continue #{project_name}",
        "description" => activity[:summary].presence || "Recent work in #{project_name}.",
        "projectName" => project_name,
        "path" => activity.fetch(:path),
        "branch" => activity[:branch],
        "updatedAt" => updated_at.iso8601
      }.compact
    }
  end

  def horoscope_evidence(horoscope)
    {
      "id" => "horoscope:#{horoscope.fetch(:sign).downcase}:#{horoscope.fetch(:date)}",
      "type" => "horoscope",
      "source" => "web.astrology",
      "epistemicStatus" => "observation",
      "confidence" => 0.9,
      "generatedAt" => horoscope.fetch(:date).in_time_zone.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => horoscope.fetch(:sign),
        "description" => horoscope.fetch(:description),
        "url" => horoscope.fetch(:url),
        "author" => horoscope[:author],
        "date" => horoscope.fetch(:date).iso8601,
        "siteName" => "Astrology.com"
      }.compact
    }
  end
end
