module Surfaces
  class PersistPlan
    def self.call(plan:, source_state_digest: nil, composition_version: "1")
      new(plan:, source_state_digest:, composition_version:).call
    end

    def initialize(plan:, source_state_digest:, composition_version:)
      @plan = plan
      @source_state_digest = source_state_digest
      @composition_version = composition_version
    end

    def call
      Surface.transaction do
        surface = Surface.create!(
          status: "draft",
          understanding: @plan.understanding,
          current_intention: @plan.current_intention,
          focus_item_key: @plan.focus_item_id,
          generated_at: @plan.generated_at || Time.current,
          source_state_digest: @source_state_digest,
          composition_version: @composition_version
        )

        Array(@plan.items).each_with_index do |item, position|
          surface.surface_items.create!(
            item_key: item.id,
            kind: item.kind,
            intent: item.intent,
            renderer: item.renderer,
            depth: item.depth,
            state: item.state || "presented",
            title: item.title,
            summary: item.summary,
            position: position,
            context_refs: item.context_refs || [],
            source_refs: item.source_refs || [],
            actions: item.actions || [],
            relationships: item.respond_to?(:relationships) ? item.relationships || [] : [],
            metadata: item.respond_to?(:metadata) ? item.metadata || {} : {}
          )
        end

        surface
      end
    end
  end
end
