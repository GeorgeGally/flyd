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

    def extract_decisions(conversation, message_range: 10)
      visible_messages = conversation.messages.ordered.reject(&:context_superseded?).last(message_range)
      decision_segments(visible_messages).each do |source_message, segment|
        next if source_message.metadata["decision_extraction_completed_at"].present?

        extract_segment_decisions(conversation, source_message, segment)
      end
    end

    def inject_context_into_prompt(base_prompt)
      items = fetch_context_items
      return base_prompt if items.empty?

      context = format_context(items)
      "#{context}\n\n---\n\n#{base_prompt}"
    end

    private

    def decision_segments(messages)
      segments = []
      current_source = nil
      current_messages = []

      messages.each do |message|
        if message.role == "user"
          segments << [ current_source, current_messages ] if current_source
          current_source = message
          current_messages = [ message ]
        elsif current_source
          current_messages << message
        end
      end
      segments << [ current_source, current_messages ] if current_source
      segments
    end

    def extract_segment_decisions(conversation, source_message, segment)
      transcript = segment.map { |message| "#{message.role}: #{message.content}" }.join("\n")
      return mark_extraction_complete!(source_message) if transcript.blank?

      prompt = <<~PROMPT
        Analyze this single user-response segment and extract decisions or conclusions made in it.
        Return ONLY a JSON array of objects with a "content" field.
        If no decisions were made, return an empty array: []

        Segment:
        #{transcript}
      PROMPT

      response = call_llm(prompt)
      parse_decisions(response).each do |decision|
        content = decision["content"].to_s.strip
        next if content.blank?
        next if @project.decisions.exists?(source_message: source_message, content: content)

        @project.decisions.create!(
          conversation: conversation,
          source_message: source_message,
          content: content,
          extracted_at: Time.current,
          confidence: 0.6
        )
      end
      mark_extraction_complete!(source_message)
    rescue StandardError => error
      Rails.logger.warn("Decision extraction failed for message #{source_message.id}: #{error.message}")
    end

    def mark_extraction_complete!(message)
      message.update!(
        metadata: message.metadata.merge("decision_extraction_completed_at" => Time.current.iso8601)
      )
    end

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
        { role: "system", content: "You extract decisions made in one user-response segment. Return ONLY a JSON array of objects with a 'content' field. If no decisions were made, return: []" },
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
