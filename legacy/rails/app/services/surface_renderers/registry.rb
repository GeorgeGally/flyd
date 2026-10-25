module SurfaceRenderers
  class Registry
    RENDERERS = {
      "hero_scene" => { partial: "surfaces/renderers/hero_scene", kinds: %w[scene insight decision question] },
      "supporting_card" => { partial: "surfaces/renderers/supporting_card", kinds: %w[scene insight decision question reminder status] },
      "conversation" => { partial: "surfaces/renderers/conversation", kinds: %w[conversation question] },
      "document" => { partial: "surfaces/renderers/document", kinds: %w[artifact insight decision] },
      "notification" => { partial: "surfaces/renderers/notification", kinds: %w[notification reminder status] },
      "code" => { partial: "surfaces/renderers/code", kinds: %w[artifact insight] },
      "data_table" => { partial: "surfaces/renderers/data_table", kinds: %w[artifact insight status] },
      "media" => { partial: "surfaces/renderers/media", kinds: %w[artifact insight] },
      "decision_scene" => { partial: "surfaces/renderers/decision_scene", kinds: %w[decision question] },
      "investigation_scene" => { partial: "surfaces/renderers/investigation_scene", kinds: %w[question insight scene] },
      "action_scene" => { partial: "surfaces/renderers/action_scene", kinds: %w[scene artifact status] },
      "discovery_scene" => { partial: "surfaces/renderers/discovery_scene", kinds: %w[insight artifact] },
      "task_orientation" => { partial: "surfaces/renderers/task_orientation", kinds: %w[scene status] , runtime: true },
      "task_plan" => { partial: "surfaces/renderers/task_plan", kinds: %w[decision scene], runtime: true },
      "worker_monitor" => { partial: "surfaces/renderers/worker_monitor", kinds: %w[status notification], runtime: true },
      "task_review" => { partial: "surfaces/renderers/task_review", kinds: %w[artifact status scene question], runtime: true },
      "task_completion" => { partial: "surfaces/renderers/task_completion", kinds: %w[artifact status scene], runtime: true }
    }.freeze
    LEGACY_ALIASES = {
      "card" => "supporting_card",
      "build" => "action_scene",
      "image" => "media",
      "timeline" => "supporting_card"
    }.freeze

    class << self
      def ids
        RENDERERS.keys
      end

      def kinds
        RENDERERS.values.flat_map { |definition| definition[:kinds] }.uniq
      end

      def supported?(id, kind: nil)
        definition = RENDERERS[id.to_s]
        definition.present? && (kind.nil? || definition[:kinds].include?(kind.to_s))
      end

      def fetch(id)
        RENDERERS.fetch(LEGACY_ALIASES.fetch(id.to_s, id.to_s), RENDERERS.fetch("supporting_card"))
      end
    end
  end
end
