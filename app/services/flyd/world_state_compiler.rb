module Flyd
  class WorldStateCompiler
    Result = Data.define(:state, :reference_registry, :diagnostics)

    DEFAULT_BUDGET = 24_000
    MAX_PROVIDER_ITEMS = 12
    MAX_PROJECTS = 8
    MAX_MEMORIES_PER_PROJECT = 5

    def self.call(active_conversation: nil, active_intent: nil, budget: DEFAULT_BUDGET, state_provider: IntelligenceState::Registry)
      new(active_conversation:, active_intent:, budget:, state_provider:).call
    end

    def initialize(active_conversation:, active_intent:, budget:, state_provider:)
      @active_conversation = active_conversation
      @active_intent = active_intent
      @budget = budget
      @state_provider = state_provider
      @references = {}
      @dropped = []
    end

    def call
      state = {
        generated_at: Time.current.iso8601,
        active_intent: intent_snapshot,
        active_interaction: conversation_snapshot,
        previous_surface: surface_snapshot,
        provider_state: provider_snapshot,
        projects: project_snapshots,
        context_corrections: correction_snapshots,
        capabilities: SurfaceActions::Registry.ids,
        renderers: SurfaceRenderers::Registry.ids
      }

      state = enforce_budget(state)
      Result.new(
        state: state,
        reference_registry: @references.keys,
        diagnostics: {
          input_characters: JSON.generate(state).length,
          dropped: @dropped,
          budget: @budget
        }
      )
    end

    private

    def provider_snapshot
      snapshot = @state_provider.snapshot.deep_symbolize_keys
      providers = Array(snapshot[:providers]).map do |provider|
        data = provider[:data].to_h.transform_values do |items|
          Array(items).first(MAX_PROVIDER_ITEMS).filter_map { |item| normalize_evidence(item) }
        end
        {
          source: provider[:source],
          generated_at: provider[:generated_at],
          fresh: provider[:fresh],
          errors: Array(provider[:errors]),
          data: data
        }
      end
      { providers: providers }
    end

    def normalize_evidence(item)
      item = item.deep_stringify_keys
      id = item["id"]
      type = item["type"]
      return unless id.present? && type.present?

      register(type, id)
      {
        id: id,
        type: type,
        source: item["source"],
        epistemic_status: item["epistemicStatus"] || item["epistemic_status"],
        confidence: item["confidence"],
        generated_at: item["generatedAt"] || item["generated_at"],
        evidence_refs: Array(item["evidenceRefs"] || item["evidence_refs"]),
        content: item["content"].to_h
      }
    end

    def project_snapshots
      Project.active.includes(:decisions, :beliefs, conversations: :messages).order(updated_at: :desc).limit(MAX_PROJECTS).map do |project|
        register("project", project.id)
        {
          id: project.id,
          name: project.name,
          description: project.description.to_s.truncate(500),
          updated_at: project.updated_at&.iso8601,
          decisions: project.decisions.sort_by(&:created_at).last(MAX_MEMORIES_PER_PROJECT).map do |decision|
            register("decision", decision.id)
            {
              id: decision.id,
              content: decision.content.to_s.truncate(500),
              confidence: decision.confidence,
              created_at: decision.created_at&.iso8601
            }
          end,
          beliefs: project.beliefs.sort_by(&:updated_at).last(MAX_MEMORIES_PER_PROJECT).map do |belief|
            register("belief", belief.id)
            {
              id: belief.id,
              statement: belief.statement.to_s.truncate(500),
              confidence: belief.confidence,
              status: belief.status,
              updated_at: belief.updated_at&.iso8601
            }
          end
        }
      end
    end

    def conversation_snapshot
      return unless @active_conversation

      register("conversation", @active_conversation.id)
      {
        id: @active_conversation.id,
        project_id: @active_conversation.project_id,
        summary: @active_conversation.summary,
        messages: @active_conversation.messages.ordered.last(10).map do |message|
          register("message", message.id)
          { id: message.id, role: message.role, content: message.content.to_s.truncate(700) }
        end
      }
    end

    def intent_snapshot
      return unless @active_intent

      register("intent", @active_intent.id)
      {
        id: @active_intent.id,
        text: @active_intent.input_text.to_s.truncate(1_500),
        modality: @active_intent.modality,
        status: @active_intent.status,
        context_candidates: @active_intent.context_candidates,
        resolved_contexts: @active_intent.resolved_contexts,
        requested_capability: @active_intent.requested_capability
      }
    end

    def surface_snapshot
      surface = Surface.current
      return unless surface

      register("surface", surface.id)
      {
        id: surface.id,
        understanding: surface.understanding.to_s.truncate(600),
        current_intention: surface.current_intention.to_s.truncate(400),
        generated_at: surface.generated_at&.iso8601,
        items: surface.items.first(3).map do |item|
          register("surface_item", item.item_key)
          { id: item.item_key, kind: item.kind, title: item.title, state: item.state }
        end
      }
    end

    def correction_snapshots
      ContextCorrection.order(created_at: :desc).limit(12).map do |correction|
        {
          original_contexts: correction.original_contexts,
          corrected_contexts: correction.corrected_contexts,
          reason: correction.reason,
          created_at: correction.created_at.iso8601
        }
      end
    end

    def enforce_budget(state)
      return state if JSON.generate(state).length <= @budget

      mutable = state.deep_dup
      providers = mutable.dig(:provider_state, :providers) || []
      providers.each do |provider|
        provider[:data].each do |key, items|
          while items.length > 3 && JSON.generate(mutable).length > @budget
            dropped = items.pop
            @dropped << "provider:#{provider[:source]}:#{key}:#{dropped[:id]}"
          end
        end
      end

      while mutable[:projects].length > 3 && JSON.generate(mutable).length > @budget
        dropped = mutable[:projects].pop
        @dropped << "project:#{dropped[:id]}"
      end

      mutable[:active_interaction]&.dig(:messages)&.shift while mutable[:active_interaction]&.dig(:messages)&.length.to_i > 4 && JSON.generate(mutable).length > @budget
      mutable
    end

    def register(type, id)
      @references["#{type}:#{id}"] = true
    end
  end
end
