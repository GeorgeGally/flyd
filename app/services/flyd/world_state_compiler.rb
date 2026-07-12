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
      @seen_evidence = {}
    end

    def call
      unbounded_state = {
        generated_at: Time.current.iso8601,
        active_intent: intent_snapshot,
        active_interaction: conversation_snapshot,
        previous_surface: surface_snapshot,
        provider_state: provider_snapshot,
        projects: project_snapshots,
        context_corrections: correction_snapshots,
        recent_feedback: feedback_snapshots,
        capabilities: SurfaceActions::Registry.ids,
        renderers: SurfaceRenderers::Registry.ids
      }
      budgeted = StateBudget.call(state: unbounded_state, budget: @budget)
      state = budgeted.state

      Result.new(
        state: state,
        reference_registry: ReferenceRegistry.call(state),
        diagnostics: {
          input_characters: JSON.generate(state).length,
          dropped: budgeted.dropped,
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
          snapshot_id: provider[:snapshot_id],
          state_digest: provider[:state_digest],
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

      key = "#{type}:#{id}"
      return if @seen_evidence[key]

      @seen_evidence[key] = true
      {
        id: id,
        type: type,
        source: item["source"],
        epistemic_status: item["epistemicStatus"] || item["epistemic_status"],
        confidence: item["confidence"],
        generated_at: item["generatedAt"] || item["generated_at"],
        evidence_refs: Array(item["evidenceRefs"] || item["evidence_refs"]),
        content: compact_content(item["content"].to_h)
      }
    end

    def compact_content(content)
      content.transform_values do |value|
        case value
        when String then value.truncate(1_000)
        when Array then value.first(20)
        else value
        end
      end
    end

    def project_snapshots
      Project.active.includes(:decisions, :beliefs).order(updated_at: :desc).limit(MAX_PROJECTS).map do |project|
        {
          id: project.id,
          name: project.name,
          description: project.description.to_s.truncate(500),
          updated_at: project.updated_at&.iso8601,
          decisions: project.decisions.sort_by(&:created_at).last(MAX_MEMORIES_PER_PROJECT).map do |decision|
            {
              id: decision.id,
              content: decision.content.to_s.truncate(500),
              confidence: decision.confidence,
              source_message_id: decision.source_message_id,
              created_at: decision.created_at&.iso8601
            }
          end,
          beliefs: project.beliefs.sort_by(&:updated_at).last(MAX_MEMORIES_PER_PROJECT).map do |belief|
            {
              id: belief.id,
              statement: belief.statement.to_s.truncate(500),
              confidence: belief.confidence,
              status: belief.status,
              source_decision_ids: belief.source_decision_ids,
              updated_at: belief.updated_at&.iso8601
            }
          end
        }
      end
    end

    def conversation_snapshot
      return unless @active_conversation

      visible_messages = @active_conversation.messages.ordered.reject(&:context_superseded?).last(10)
      {
        id: @active_conversation.id,
        project_id: @active_conversation.project_id,
        context_id: @active_conversation.context_id,
        owner_name: @active_conversation.owner_name,
        summary: @active_conversation.summary,
        messages: visible_messages.map do |message|
          { id: message.id, role: message.role, content: message.content.to_s.truncate(700) }
        end
      }
    end

    def intent_snapshot
      return unless @active_intent

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

      {
        id: surface.id,
        understanding: surface.understanding.to_s.truncate(600),
        current_intention: surface.current_intention.to_s.truncate(400),
        generated_at: surface.generated_at&.iso8601,
        items: surface.items.first(3).map do |item|
          {
            id: item.item_key,
            kind: item.kind,
            title: item.title,
            state: item.state,
            context_refs: item.context_refs,
            source_refs: item.source_refs
          }
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

    def feedback_snapshots
      SurfaceFeedback.order(created_at: :desc).limit(20).map do |feedback|
        {
          surface_id: feedback.surface_id,
          item_key: feedback.surface_item&.item_key,
          signal: feedback.signal,
          created_at: feedback.created_at.iso8601
        }
      end
    end
  end
end
