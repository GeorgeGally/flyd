require "set"
require "uri"

module WebDiscovery
  class CandidatePool
    DEFAULT_LIMIT = 40
    MAX_AGE = 7.days

    def initialize(stories, limit: DEFAULT_LIMIT, max_age: MAX_AGE, now: Time.current)
      @stories = Array(stories)
      @limit = limit
      @max_age = max_age
      @now = now
    end

    def call
      distinct = deduplicate(@stories.select { |story| eligible?(story) })
      diversify(distinct.sort_by { |story| [ -story[:score].to_i, -story.fetch(:published_at).to_f ] }).first(@limit)
    end

    private

    def eligible?(story)
      story[:id].present? && story[:title].present? && safe_url(story[:url]).present? && recent?(story[:published_at])
    end

    def recent?(value)
      value.respond_to?(:to_time) && value.to_time >= @now - @max_age
    end

    def deduplicate(stories)
      urls = Set.new
      titles = Set.new
      stories.filter_map do |story|
        url = normalized_url(story.fetch(:url))
        title = normalized_title(story.fetch(:title))
        next unless urls.add?(url) && titles.add?(title)

        story
      end
    end

    def diversify(stories)
      seen = Set.new
      distinct, repeats = stories.partition do |story|
        seen.add?(story[:source_key].presence || safe_url(story[:url]).host)
      end
      distinct + repeats
    end

    def normalized_url(value)
      uri = safe_url(value)
      uri.fragment = nil
      uri.to_s.sub(%r{/\z}, "")
    end

    def normalized_title(value)
      value.to_s.downcase.gsub(/[^a-z0-9]+/, " ").squish
    end

    def safe_url(value)
      uri = URI.parse(value.to_s)
      uri if uri.scheme.in?(%w[http https]) && uri.host.present?
    rescue URI::InvalidURIError
      nil
    end
  end
end
