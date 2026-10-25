require "json"

module Flyd
  class IntentInterpreter
    Result = Data.define(:summary, :desired_outcome, :requested_capability)
    CAPABILITIES = %w[discuss build investigate decide monitor create review].freeze

    def self.call(text:, chat: Llm::Chat.new)
      new(text:, chat:).call
    end

    def initialize(text:, chat:)
      @text = text.to_s.strip
      @chat = chat
    end

    def call
      response = @chat.call([
        {
          role: "system",
          content: <<~PROMPT
            Interpret the user's intent before assigning it to any project or context.
            Return JSON only with: summary, desired_outcome, requested_capability.
            requested_capability must be one of: #{CAPABILITIES.join(", ")}.
            Do not choose a project or storage location.
          PROMPT
        },
        { role: "user", content: @text }
      ])
      payload = JSON.parse(response.to_s[/\{.*\}/m] || response.to_s)
      capability = payload["requested_capability"].to_s
      capability = heuristic_capability unless CAPABILITIES.include?(capability)

      Result.new(
        summary: payload["summary"].to_s.presence || @text.truncate(240),
        desired_outcome: payload["desired_outcome"].to_s.presence || @text.truncate(1_000),
        requested_capability: capability
      )
    rescue Llm::Chat::Error, JSON::ParserError
      fallback
    end

    private

    def fallback
      Result.new(
        summary: @text.truncate(240),
        desired_outcome: @text.truncate(1_000),
        requested_capability: heuristic_capability
      )
    end

    def heuristic_capability
      normalized = @text.downcase
      return "build" if normalized.match?(/\b(build|implement|code|ship|fix|create app|make app)\b/)
      return "investigate" if normalized.match?(/\b(research|investigate|find out|look into|audit)\b/)
      return "decide" if normalized.match?(/\b(decide|choose|which option|recommend)\b/)
      return "monitor" if normalized.match?(/\b(monitor|watch|alert|notify)\b/)
      return "create" if normalized.match?(/\b(write|draft|design|create|make)\b/)
      return "review" if normalized.match?(/\b(review|critique|check)\b/)

      "discuss"
    end
  end
end
