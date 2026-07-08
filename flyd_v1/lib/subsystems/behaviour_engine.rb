module Subsystems
  class BehaviourEngine
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
      @project.behaviours.detect { |b| b.matching_trigger?(text) }
    end

    def inject_behaviour_steps(text)
      behaviour = match_trigger(text)
      return nil unless behaviour
      behaviour.steps
    end

    private

    def extract_trigger(sequence)
      return nil if sequence.empty?

      decisions_text = sequence.each_with_index.map { |d, i| "#{i + 1}. #{d.content}" }.join("\n")

      chat = Llm::Chat.new
      response = chat.call([
        { role: "system", content: "Given these decisions made in sequence by a software team, what is the trigger phrase that would describe this pattern? Answer in 2-5 words. Return ONLY the trigger phrase, nothing else." },
        { role: "user", content: decisions_text }
      ])
      trigger = response.strip.downcase
      trigger.presence
    rescue Llm::Chat::Error
      nil
    end

    def build_steps(sequence)
      sequence.map.with_index { |d, i| { step: i + 1, action: d.content } }
    end
  end
end
