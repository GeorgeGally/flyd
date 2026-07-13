module SurfaceActions
  class Registry
    ACTIONS = {
      "discuss" => { method: :post, route: :discuss },
      "answer" => { method: :post, route: :answer },
      "choose" => { method: :post, route: :choose },
      "investigate" => { method: :post, route: :investigate },
      "build" => { method: :post, route: :build },
      "dismiss" => { method: :post, route: :feedback },
      "resolve" => { method: :post, route: :feedback },
      "inspect_sources" => { method: :get, route: :sources },
      "correct_context" => { method: :post, route: :context_correction }
    }.freeze

    class << self
      def ids
        ACTIONS.keys
      end

      def supported?(id)
        ACTIONS.key?(id.to_s)
      end

      def fetch(id)
        ACTIONS.fetch(id.to_s)
      end

      def sanitize_payload(id, payload, reference_registry:)
        payload = payload.to_h.deep_stringify_keys
        case id.to_s
        when "correct_context"
          contexts = Array(payload["contexts"]).first(3).map do |reference|
            reference = reference.to_h.deep_stringify_keys
            type = reference["type"].to_s
            identifier = reference["id"]
            key = "#{type}:#{identifier}"
            raise ArgumentError, "Unsupported correction context: #{type}" unless %w[project context].include?(type)
            raise ArgumentError, "Unknown correction context: #{key}" unless reference_registry.include?(key)

            { "type" => type, "id" => identifier }
          end
          { "contexts" => contexts }
        when "choose"
          option_id = payload["option_id"].to_s.truncate(80)
          option_label = payload["option_label"].to_s.truncate(180)
          raise ArgumentError, "Decision choice requires an option id and label" if option_id.blank? || option_label.blank?

          { "option_id" => option_id, "option_label" => option_label }
        when "investigate"
          question = payload["question"].to_s.truncate(1_000)
          raise ArgumentError, "Investigation requires a question" if question.blank?

          { "question" => question }
        when "build"
          { "instructions" => payload["instructions"].to_s.truncate(4_000) }.compact_blank
        when "dismiss", "resolve"
          {
            "reason" => payload["reason"].to_s.truncate(300),
            "note" => payload["note"].to_s.truncate(1_000)
          }.compact_blank
        else
          {}
        end
      end
    end
  end
end
