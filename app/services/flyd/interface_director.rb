module Flyd
  class InterfaceDirector
    MODES = %w[quiet conversation decision investigation action monitoring discovery].freeze

    def self.call(state)
      new(state).call
    end

    def initialize(state)
      @state = state.deep_symbolize_keys
    end

    def call
      {
        suggested_mode: suggested_mode,
        suggested_focus_scene_key: candidates.first[:scene_key],
        candidates: candidates,
        grammars: grammars,
        instruction: "Choose the interface that best resolves the present situation. Do not default to conversation or continuity."
      }
    end

    private

    def suggested_mode
      candidates.first.fetch(:mode)
    end

    def candidates
      @candidates ||= begin
        values = []
        action_scene = scene_for("build")
        decision_scene = scene_for("decision")
        investigation_scene = scene_for("investigation", "question")
        monitoring_scene = scene_for("monitoring")

        values << candidate("action", "Proposed or running work requires a confirmation or outcome", 1.0, action_scene) if actionable_build?
        values << candidate("decision", "An unresolved choice is blocking progress", 0.95, decision_scene) if decision_scene || requested_capability == "decide"
        values << candidate("investigation", "Meaningful uncertainty needs to be reduced", 0.9, investigation_scene) if investigation_scene || requested_capability == "investigate"
        values << candidate("monitoring", "A changing condition is active", 0.8, monitoring_scene) if monitoring_scene || requested_capability == "monitor"
        values.concat(EvidenceCandidates.call(@state))
        values << candidate("conversation", "Dialogue is the explicit active interaction", 0.65, conversation_scene) if @state[:active_interaction].present?
        values << candidate("quiet", "Nothing has earned a more specific interface", 0.2)
        values
          .group_by { |value| value[:mode] }
          .values
          .map { |group| group.max_by { |value| value[:confidence] } }
          .sort_by { |value| -value[:confidence] }
      end
    end

    def candidate(mode, reason, confidence, scene = nil)
      {
        mode: mode,
        reason: reason,
        confidence: confidence,
        scene_key: scene&.dig(:scene_key)
      }.compact
    end

    def actionable_build?
      Array(@state[:builds]).any? { |build| %w[proposed pending preparing running].include?(build[:status].to_s) } ||
        scene_for("build").present? ||
        requested_capability == "build"
    end

    def active_scenes
      @active_scenes ||= Array(@state[:scenes]).select do |scene|
        scene[:status].to_s == "active" && durable_scene?(scene)
      end
    end

    def durable_scene?(scene)
      %i[project_id context_id conversation_id intent_id].any? { |key| scene[key].present? }
    end

    def scene_for(*kinds)
      active_scenes.find { |scene| kinds.include?(scene[:kind].to_s) }
    end

    def conversation_scene
      scene_for("conversation")
    end

    def requested_capability
      @state.dig(:active_intent, :requested_capability).to_s
    end

    def grammars
      {
        quiet: {
          purpose: "Stay out of the way unless something genuinely deserves attention.",
          focus_renderer: "hero_scene",
          maximum_items: 1
        },
        conversation: {
          purpose: "Think with the user when dialogue is the most useful next move.",
          focus_renderer: "conversation",
          maximum_items: 2
        },
        decision: {
          purpose: "Make the choice itself the interface.",
          focus_renderer: "decision_scene",
          required_action: "choose",
          maximum_items: 3
        },
        investigation: {
          purpose: "Show what is known, what is uncertain, and the next question to pursue.",
          focus_renderer: "investigation_scene",
          required_action: "investigate",
          maximum_items: 3
        },
        action: {
          purpose: "Show the proposed work, likely impact, and confirmation boundary.",
          focus_renderer: "action_scene",
          required_action: "build",
          maximum_items: 3
        },
        monitoring: {
          purpose: "Show the changing condition and what would make it actionable.",
          focus_renderer: "notification",
          maximum_items: 2
        },
        discovery: {
          purpose: "Compose recent work, a personal daily signal, and fresh discoveries as one living stage.",
          focus_renderer: "discovery_scene",
          maximum_items: 3
        }
      }
    end
  end
end
