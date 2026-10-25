require "set"

module Flyd
  class InterfaceDirector
    MODES = %w[quiet conversation decision investigation action monitoring discovery].freeze
    SCENE_CANDIDACY_WINDOW = 24.hours

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
        scene[:status].to_s == "active" && durable_scene?(scene) && current_scene?(scene)
      end
    end

    PERSISTENT_SCENE_KINDS = %w[decision investigation build question].freeze

    # Unresolved work remains eligible after presentation. Transient scenes
    # yield once shown; explicit expiry and detached runtime evidence always win.
    def current_scene?(scene)
      return false unless live_runtime_scene?(scene)
      return false if scene_expired?(scene)
      return true if PERSISTENT_SCENE_KINDS.include?(scene[:kind].to_s)
      return false if scene[:last_presented_at].present?

      created_at = parse_time(scene[:created_at])
      return true unless created_at

      created_at >= SCENE_CANDIDACY_WINDOW.ago
    end

    def scene_expired?(scene)
      raw_expiry = scene.dig(:metadata, :expires_at)
      return false if raw_expiry.blank?

      expires_at = parse_time(raw_expiry)
      return true unless expires_at

      expires_at.present? && expires_at <= Time.current
    end

    # Scenes keyed runtime:<task_key>:<renderer> reanimate cancelled or
    # completed work unless their task is still part of the live situation.
    def live_runtime_scene?(scene)
      scene_key = scene[:scene_key].to_s
      return true unless scene_key.start_with?("runtime:")

      task_key = scene_key.split(":")[1].to_s
      return true if task_key.empty?

      live_runtime_task_keys.include?(task_key)
    end

    def live_runtime_task_keys
      @live_runtime_task_keys ||= Array(@state.dig(:provider_state, :providers)).flat_map do |provider|
        Array(provider[:data].to_h[:runtime_tasks]).map { |task| task[:id].to_s }
      end.to_set
    end

    def parse_time(value)
      Time.zone.parse(value.to_s) if value.present?
    rescue ArgumentError, TypeError
      nil
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
          task_renderer: "task_plan",
          required_action: "choose",
          maximum_items: 3
        },
        investigation: {
          purpose: "Show what is known, what is uncertain, and the next question to pursue.",
          focus_renderer: "investigation_scene",
          task_renderer: "task_review",
          required_action: "investigate",
          maximum_items: 3
        },
        action: {
          purpose: "Show the proposed work, likely impact, and confirmation boundary.",
          focus_renderer: "action_scene",
          task_renderers: %w[task_orientation task_review task_completion],
          actions_by_readiness: { ready: "build", blocked: nil, running: nil },
          maximum_items: 3
        },
        monitoring: {
          purpose: "Show the changing condition and what would make it actionable.",
          focus_renderer: "notification",
          task_renderer: "worker_monitor",
          maximum_items: 2
        },
        discovery: {
          purpose: "Compose recent work, a personal daily signal, and fresh discoveries as one living stage.",
          focus_renderer: "discovery_scene",
          maximum_items: 4
        }
      }
    end
  end
end
