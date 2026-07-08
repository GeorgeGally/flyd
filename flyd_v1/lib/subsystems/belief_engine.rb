module Subsystems
  class BeliefEngine
    def initialize(project)
      @project = project
    end

    def synthesize(new_decisions)
      groups = group_decisions(new_decisions)
      groups.each do |topic, decisions|
        belief = find_or_create_belief(topic, decisions)
        belief.reinforce! if belief.persisted?
      end
    end

    def compute_attention(limit: 5)
      Belief.active
        .where(project: @project).or(Belief.where(project: nil))
        .order(confidence: :desc, updated_at: :desc)
        .limit(limit)
    end

    def detect_contradictions(decision)
      @project.beliefs.active.each do |belief|
        if potentially_contradicts?(belief.statement, decision.content)
          belief.challenge!
        end
      end
    end

    private

    def group_decisions(decisions)
      decisions.group_by { |d| extract_topic(d.content) }
    end

    def extract_topic(content)
      return "unknown" if content.blank?

      chat = Llm::Chat.new
      response = chat.call([
        { role: "system", content: "What topic does this decision relate to? Answer in 1-3 words. Return ONLY the topic words, nothing else." },
        { role: "user", content: content }
      ])
      topic = response.strip.downcase.gsub(/[^a-z0-9\s]/, "")
      topic.presence || fallback_topic(content)
    rescue Llm::Chat::Error
      fallback_topic(content)
    end

    def fallback_topic(content)
      content.downcase.split.first(3).join("_")
    end

    def find_or_create_belief(topic, decisions)
      safe_topic = ActiveRecord::Base.sanitize_sql_like(topic)
      existing = @project.beliefs.active.find_by("statement ILIKE ?", "%#{safe_topic}%")
      return existing if existing

      statement = "Based on recent decisions: #{decisions.map(&:content).join('; ')}"
      @project.beliefs.create!(
        statement: statement.truncate(500),
        confidence: 0.3,
        status: "active"
      )
    end

    def potentially_contradicts?(belief_statement, decision_content)
      return false if belief_statement.blank? || decision_content.blank?

      chat = Llm::Chat.new
      response = chat.call([
        { role: "system", content: "Does the following decision contradict the existing belief? Answer ONLY 'yes' or 'no'." },
        { role: "user", content: "Belief: #{belief_statement}\nDecision: #{decision_content}" }
      ])
      response.strip.match?(/\Ay/i)
    rescue Llm::Chat::Error
      false
    end
  end
end
