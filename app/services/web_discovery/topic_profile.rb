require "set"

module WebDiscovery
  class TopicProfile
    STOPWORDS = %w[
      about after also been before build can command current deep does from have into launch more news only
      review should than that the their there these this through using what when where which while with without
      write your flyd ship report plan planning project implementation test
    ].to_set.freeze

    def initialize(snapshot)
      @data = snapshot.data.to_h.deep_symbolize_keys
    end

    def select(stories, limit: 8)
      enriched = Array(stories).map { |story| enrich(story) }
      matched, unmatched = enriched.partition { |story| story[:matched_topics].any? }
      matched.sort_by! { |story| [ -story[:matched_topics].length, -story[:score].to_i ] }
      unmatched.sort_by! { |story| -story[:score].to_i }
      (matched + unmatched).first(limit)
    end

    private

    def enrich(story)
      title = story[:title].to_s.downcase
      matches = terms.select { |term| title.match?(/\b#{Regexp.escape(term)}\b/) }
      story.merge(
        matched_topics: matches,
        relevance_reason: matches.any? ? "Matches your interests: #{matches.join(", ")}" : "Serendipity from today's top stories"
      )
    end

    def terms
      @terms ||= source_text.flat_map { |value| tokenize(value) }.uniq.first(80)
    end

    def source_text
      values = []
      Array(@data[:goals]).each do |item|
        content = item[:content].to_h.deep_symbolize_keys
        values << content[:title]
        values.concat(Array(content[:topics]))
      end
      Array(@data[:signals]).each { |item| values << item.dig(:content, :topic) }
      Array(@data[:reports]).each { |item| values << item.dig(:content, :title) }
      Array(@data[:recent_events]).each { |item| values.concat(Array(item.dig(:content, :topics))) }
      values.compact
    end

    def tokenize(value)
      value.to_s.downcase.scan(/[a-z0-9][a-z0-9+-]{2,}/).reject { |word| STOPWORDS.include?(word) }
    end
  end
end
