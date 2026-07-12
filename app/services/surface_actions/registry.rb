module SurfaceActions
  class Registry
    ACTIONS = {
      "discuss" => { method: :post, route: :discuss },
      "answer" => { method: :post, route: :answer },
      "approve" => { method: :post, route: :feedback },
      "reject" => { method: :post, route: :feedback },
      "dismiss" => { method: :post, route: :feedback },
      "resolve" => { method: :post, route: :feedback },
      "inspect_sources" => { method: :get, route: :sources },
      "correct_context" => { method: :post, route: :context_correction },
      "open_artifact" => { method: :get, route: :artifact }
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
    end
  end
end
