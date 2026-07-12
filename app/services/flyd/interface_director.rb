module Flyd
  class InterfaceDirector
    MODES = %w[quiet conversation decision investigation action monitoring].freeze

    def self.call(state)
      new(state).call
    end

    def initialize(state)
      @state = state.deep_symbolize_keys
    end

    def call
      {
        suggested_mode: suggested_mode,
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
        values << candidate("action", "A proposed or running action requires attention", 1.0) if actionable_build?
        values << candidate("decision", "The current work is a real unresolved choice", 0.95) if current_kind == "decision" || requested_capability == "decide"
        values << candidate("investigation", "The current work requires reducing uncertainty", 0.9) if %w[investigation question].include?(current_kind) || requested_capability == "investigate"
        values << candidate("monitoring", "A monitoring scene is active", 0.8) if current_kind == "monitoring" || requested_capability == "monitor"
        values << candidate("conversation", "A live interaction is explicitly active", 0.7) if @state[:active_interaction].present?
        values << candidate("quiet", "Nothing currently requires a more specific interface", 0.2)
        values.sort_by { |value| -value[:confidence] }
      end
    end

    def candidate(mode, reason, confidence)
      { mode: mode, reason: reason, confidence: confidence }
    end

    def actionable_build?
      Array(@state[:builds]).any? { |build| %w[proposed pending preparing running].include?(build[:status].to_s) } || requested_capability == "build"
    end

    def current_kind
      @state.dig(:current_work, :kind).to_s
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
        }
      }
    end
  end
end
