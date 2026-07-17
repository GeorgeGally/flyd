require "json"
require "set"

module Flyd
  class TasteCurator
    ValidationError = Class.new(StandardError)
    VERDICTS = %w[hot worth_a_look skip].freeze
    VERDICT_PRIORITY = { "hot" => 0, "worth_a_look" => 1 }.freeze

    def initialize(stories:, context:, chat: Llm::Chat.new, limit: 8)
      @stories = Array(stories)
      @context = context.to_h.deep_symbolize_keys
      @chat = chat
      @limit = limit
    end

    def call
      return [] if @stories.empty?

      candidates = indexed_candidates
      payload = parse(@chat.call!(messages(candidates)))
      judgments = validate_judgments(payload, candidates)
      accepted = judgments.reject { |judgment| judgment.fetch("verdict") == "skip" }
      rabbit_hole_key = validate_rabbit_hole(payload["rabbit_hole_key"], accepted)

      accepted
        .sort_by { |judgment| judgment_priority(judgment, rabbit_hole_key) }
        .first(@limit)
        .map { |judgment| curated_story(candidates.fetch(judgment.fetch("key")), judgment, rabbit_hole_key) }
    rescue JSON::ParserError, TypeError => error
      raise ValidationError, "Invalid taste curation response: #{error.message}"
    end

    private

    def messages(candidates)
      [
        { role: "system", content: system_prompt },
        {
          role: "user",
          content: JSON.generate(
            personal_context: personal_context,
            candidates: candidates.values.map { |story| candidate_payload(story) }
          )
        }
      ]
    end

    def system_prompt
      <<~PROMPT
        You are Flyd judging whether the user would genuinely find each story interesting. Curate comparatively across the entire batch; do not classify by topic alone.

        Taste profile:
        - Weird over practical.
        - Novel over important.
        - Deep dives over breaking news.
        - Hacker mindset over consumer mindset.
        - Favor internet archaeology, creative code, hardware weirdness, protocol history, obscure media, unusual projects, and severe constraints.
        - Skip generic politics, wars, disasters, consumer churn, and incremental improvements unless they genuinely intersect with technical, creative, or hacker culture.

        Return one JSON object only:
        {
          "judgments": [{"key":"exact candidate key","verdict":"hot|worth_a_look|skip","reason":"one specific sentence"}],
          "rabbit_hole_key":"exact key of the single most weird, deep, or fun accepted item"
        }

        Judge every candidate exactly once. Be opinionated. `hot` means genuinely novel or unusually compelling. `worth_a_look` means specifically useful or intriguing. `skip` means it does not earn attention. Give every verdict a concrete reason. If anything is accepted, choose exactly one accepted rabbit hole; otherwise use null. The rabbit hole should be a project, tool, archive, oddity, or deep essay, not a conventional news headline.
      PROMPT
    end

    def indexed_candidates
      @stories.each_with_object({}) do |story, values|
        key = candidate_key(story)
        raise ValidationError, "Duplicate candidate key: #{key}" if values.key?(key)

        values[key] = story.merge(curation_key: key)
      end
    end

    def candidate_key(story)
      "#{story[:source_key].presence || "story"}:#{story.fetch(:id)}"
    end

    def candidate_payload(story)
      {
        key: story.fetch(:curation_key),
        title: story.fetch(:title),
        description: story[:description].to_s.truncate(500),
        source: story[:source_name].presence || story[:source_key],
        category: story[:source_category],
        url: story.fetch(:url),
        published_at: story.fetch(:published_at).iso8601
      }.compact
    end

    def personal_context
      cli = @context[:cli].to_h
      personal = @context[:personal].to_h
      {
        goals: content_values(cli[:goals], :title),
        signals: content_values(cli[:signals], :topic),
        reports: content_values(cli[:reports], :title),
        recent_work: content_values(personal[:activities], :title),
        taste_profile: Array(cli[:profile]).first.to_h.deep_symbolize_keys.dig(:content, :taste) || {}
      }
    end

    def content_values(items, key)
      Array(items).filter_map do |item|
        item.to_h.deep_symbolize_keys.dig(:content, key).presence
      end.first(6)
    end

    def parse(response)
      text = response.to_s.strip
      JSON.parse(text[/\{.*\}/m] || text)
    end

    def validate_judgments(payload, candidates)
      judgments = Array(payload["judgments"])
      raise ValidationError, "Every candidate must be judged" unless judgments.length == candidates.length

      seen = Set.new
      judgments.each_with_index.map do |raw_judgment, index|
        judgment = raw_judgment.to_h.stringify_keys
        key = judgment["key"].to_s
        verdict = judgment["verdict"].to_s
        raise ValidationError, "Unknown candidate key: #{key}" unless candidates.key?(key)
        raise ValidationError, "Duplicate judgment: #{key}" unless seen.add?(key)
        raise ValidationError, "Unknown verdict for #{key}" unless VERDICTS.include?(verdict)
        raise ValidationError, "Missing reason for #{key}" if judgment["reason"].blank?

        judgment.merge("index" => index)
      end
    end

    def validate_rabbit_hole(value, accepted)
      key = value.presence
      return nil if accepted.empty? && key.nil?

      accepted_keys = accepted.pluck("key")
      raise ValidationError, "An accepted rabbit hole is required" unless accepted_keys.include?(key)

      key
    end

    def judgment_priority(judgment, rabbit_hole_key)
      [ judgment.fetch("key") == rabbit_hole_key ? 0 : 1, VERDICT_PRIORITY.fetch(judgment.fetch("verdict")), judgment.fetch("index") ]
    end

    def curated_story(story, judgment, rabbit_hole_key)
      story.except(:curation_key).merge(
        interest_verdict: judgment.fetch("verdict"),
        interest_reason: judgment.fetch("reason"),
        rabbit_hole: judgment.fetch("key") == rabbit_hole_key
      )
    end
  end
end
