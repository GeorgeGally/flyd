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
      "media" => { partial: "surfaces/renderers/media", kinds: %w[artifact insight] }
    }.freeze
    LEGACY_ALIASES = {
      "card" => "supporting_card",
      "build" => "document",
      "image" => "media",
      "timeline" => "supporting_card"
    }.freeze

    class << self
      def ids
        RENDERERS.keys
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
