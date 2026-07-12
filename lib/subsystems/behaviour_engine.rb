module Subsystems
  class BehaviourEngine
    STOP_WORDS = %w[use with for and the a an to of in on primary decision].freeze

    def initialize(project)
      @project = project
    end

    def compile_from_patterns(decision_sequences)
      decision_sequences.each do |sequence|
        trigger = extract_trigger(sequence)
        next unless trigger

        existing = @project.behaviours.find_by(trigger_phrase: trigger)
        if existing
          existing.reinforce!
        else
          @project.behaviours.create!(
            name: trigger.truncate(50),
            trigger_phrase: trigger,
            description: "Learned from #{sequence.length} decisions",
            steps: build_steps(sequence),
            success_count: 0,
            failure_count: 0
          )
        end
      end
    end

    def match_trigger(text)
      @project.behaviours.detect { |behaviour| behaviour.matching_trigger?(text) }
    end

    def inject_behaviour_steps(text)
      behaviour = match_trigger(text)
      behaviour&.steps
    end

    private

    def extract_trigger(sequence)
      return if sequence.empty?

      decisions_text = sequence.each_with_index.map { |decision, index| "#{index + 1}. #{decision.content}" }.join("\n")
      response = Llm::Chat.new.call([
        { role: "system", content: "Given these decisions made in sequence by a software team, what is the trigger phrase that would describe this pattern? Answer in 2-5 words. Return ONLY the trigger phrase, nothing else." },
        { role: "user", content: decisions_text }
      ])
      response.to_s.strip.downcase.presence || heuristic_trigger(sequence)
    rescue Llm::Chat::Error
      heuristic_trigger(sequence)
    end

    def heuristic_trigger(sequence)
      words = sequence.flat_map { |decision| decision.content.to_s.downcase.scan(/[a-z0-9]+/) }
      frequencies = words.reject { |word| word.length < 4 || STOP_WORDS.include?(word) }.tally
      selected = frequencies.sort_by { |word, count| [ -count, word ] }.first(3).map(&:first)
      selected.presence&.join(" ") || "repeated decision pattern"
    end

    def build_steps(sequence)
      sequence.map.with_index { |decision, index| { step: index + 1, action: decision.content } }
    end
  end
end
