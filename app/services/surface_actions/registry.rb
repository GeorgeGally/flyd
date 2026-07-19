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
      "correct_context" => { method: :post, route: :context_correction },
      "approve_task_grant" => { method: :post, route: :runtime },
      "reject_task_grant" => { method: :post, route: :runtime },
      "stop_worker" => { method: :post, route: :runtime },
      "retry_worker" => { method: :post, route: :runtime },
      "redirect_worker" => { method: :post, route: :runtime },
      "replace_worker" => { method: :post, route: :runtime },
      "correct_task" => { method: :post, route: :runtime },
      "confirm_task_completion" => { method: :post, route: :runtime }
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
        when "approve_task_grant", "reject_task_grant"
          ensure_exact_fields!(payload, %w[task_key task_revision grant_key])
          task_payload(payload, reference_registry:).merge(
            "grant_key" => referenced_key!(payload, "grant_key", "task_grant", reference_registry)
          )
        when "stop_worker", "retry_worker", "redirect_worker", "replace_worker"
          ensure_exact_fields!(payload, %w[task_key task_revision worker_key])
          task_payload(payload, reference_registry:).merge(
            "worker_key" => referenced_key!(payload, "worker_key", "worker_session", reference_registry)
          )
        when "correct_task"
          ensure_exact_fields!(payload, %w[task_key task_revision original_claim])
          original_claim = payload["original_claim"].to_s.truncate(4_000)
          raise ArgumentError, "Task correction requires the claim being corrected" if original_claim.blank?

          task_payload(payload, reference_registry:).merge(
            "original_claim" => original_claim
          )
        when "confirm_task_completion"
          ensure_exact_fields!(payload, %w[task_key task_revision summary])
          summary = payload["summary"].to_s.truncate(4_000)
          raise ArgumentError, "Task completion requires a summary" if summary.blank?

          task_payload(payload, reference_registry:).merge("summary" => summary)
        else
          {}
        end
      end

      private

      def task_payload(payload, reference_registry:)
        {
          "task_key" => referenced_key!(payload, "task_key", "runtime_task", reference_registry),
          "task_revision" => non_negative_integer!(payload, "task_revision")
        }
      end

      def referenced_key!(payload, field, type, reference_registry)
        value = payload[field].to_s
        raise ArgumentError, "#{field} is required" if value.blank?
        raise ArgumentError, "Unknown #{field}: #{value}" unless reference_registry.include?("#{type}:#{value}")

        value
      end

      def non_negative_integer!(payload, field)
        value = Integer(payload[field], exception: false)
        raise ArgumentError, "#{field} must be a non-negative integer" unless value && value >= 0

        value
      end

      def ensure_exact_fields!(payload, allowed)
        unknown = payload.keys - allowed
        raise ArgumentError, "Unknown task action field: #{unknown.first}" if unknown.any?
      end
    end
  end
end
