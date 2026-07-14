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
        relevance_reason: matches.any? ? "Matches your interests: #{matches.join(", ")}" : "From today's top stories"
      )
    end

    def terms
      @terms ||= source_terms.uniq.first(80)
    end

    def source_terms
      values = []
      Array(@data[:goals]).each do |item|
        content = item[:content].to_h.deep_symbolize_keys
        values.concat(title_terms(content[:title]))
        values.concat(Array(content[:topics]).flat_map { |topic| topic_terms(topic) })
      end
      Array(@data[:signals]).each { |item| values.concat(topic_terms(item.dig(:content, :topic))) }
      Array(@data[:reports]).each { |item| values.concat(title_terms(item.dig(:content, :title))) }
      Array(@data[:recent_events]).each do |item|
        values.concat(Array(item.dig(:content, :topics)).flat_map { |topic| topic_terms(topic) })
      end
      values
    end

    def title_terms(value)
      tokenize(value).select { |word| word.length >= 5 }
    end

    def topic_terms(value)
      words = tokenize(value)
      return [] if words.empty?
      return words.select { |word| word.length >= 5 } if words.one?

      [ words.join(" ") ]
    end

    def tokenize(value)
      value.to_s.downcase.scan(/[a-z0-9][a-z0-9+-]{2,}/).reject { |word| STOPWORDS.include?(word) }
    end
  end
end
