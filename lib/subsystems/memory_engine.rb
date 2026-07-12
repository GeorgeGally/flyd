module Subsystems
  class MemoryEngine
    MAX_CONTEXT_TOKENS = 2000

    def initialize(project)
      @project = project
    end

    def relevant_context(conversation)
      items = fetch_context_items
      format_context(items)
    end

    def extract_decisions(conversation, message_range: 5)
      recent_messages = conversation.messages.ordered.reject(&:context_superseded?).last(message_range)
      source_message = recent_messages.reverse.find { |message| message.role == "user" }
      recent = recent_messages.map(&:content).join("\n")
      return if recent.blank? || source_message.nil?

      prompt = <<~PROMPT
        Analyze this conversation and extract any decisions or conclusions made.
        For each decision, return ONLY a JSON array of objects with a "content" field.
        If no decisions were made, return an empty array: []

        Conversation:
        #{recent}
      PROMPT

      begin
        response = call_llm(prompt)
        decisions = parse_decisions(response)
        decisions.each do |decision|
          @project.decisions.create!(
            conversation: conversation,
            source_message: source_message,
            content: decision["content"],
            extracted_at: Time.current,
            confidence: 0.6
          )
        end
      rescue StandardError => error
        Rails.logger.warn("Decision extraction failed: #{error.message}")
      end
    end

    def inject_context_into_prompt(base_prompt)
      items = fetch_context_items
      return base_prompt if items.empty?

      context = format_context(items)
      "#{context}\n\n---\n\n#{base_prompt}"
    end

    private

    def fetch_context_items
      decisions = @project.decisions.by_recency.limit(5).to_a
      beliefs = fetch_beliefs
      decisions + beliefs
    end

    def fetch_beliefs
      return [] unless defined?(Belief)

      Belief.where(project: @project).or(Belief.where(project: nil)).order(updated_at: :desc).limit(3).to_a
    rescue NameError
      []
    end

    def format_context(items)
      return "" if items.empty?

      lines = [ "## Project Context" ]
      items.each do |item|
        type = item.is_a?(Decision) ? "Decision" : "Belief"
        text = item.respond_to?(:content) ? item.content : item.statement
        lines << "- [#{type}] #{text.truncate(200)}"
      end
      lines.join("\n")
    end

    def call_llm(prompt)
      chat = Llm::Chat.new
      chat.call([
        { role: "system", content: "You extract decisions made in software team conversations. Return ONLY a JSON array of objects with a 'content' field for each decision. If no decisions were made, return: []" },
        { role: "user", content: prompt }
      ])
    rescue Llm::Chat::Error => error
      Rails.logger.warn("Decision extraction LLM call failed: #{error.message}")
      "[]"
    end

    def parse_decisions(json)
      JSON.parse(json)
    rescue JSON::ParserError
      []
    end
  end
end
