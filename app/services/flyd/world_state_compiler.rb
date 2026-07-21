module Flyd
  class WorldStateCompiler
    Result = Data.define(:state, :reference_registry, :diagnostics) do
      def self.rebudget(state, budget:, diagnostics: {}, extra_diagnostics: {})
        budgeted = StateBudget.call(state: state, budget: budget)
        retained_state = budgeted.state

        new(
          state: retained_state,
          reference_registry: ReferenceRegistry.call(retained_state),
          diagnostics: diagnostics.merge(
            input_characters: JSON.generate(retained_state).length,
            dropped: Array(diagnostics[:dropped]) + budgeted.dropped,
            budget: budget
          ).merge(extra_diagnostics)
        )
      end
    end

    DEFAULT_BUDGET = 28_000
    MAX_PROVIDER_ITEMS = 12
    MAX_PROJECTS = 8
    MAX_MEMORIES_PER_PROJECT = 5
    MAX_SCENES = 12
    MAX_ARTIFACTS = 10
    MAX_BUILDS = 10

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
        current_work: current_work_snapshot,
        active_intent: intent_snapshot,
        active_interaction: conversation_snapshot,
        previous_surface: surface_snapshot,
        provider_state: provider_snapshot,
        scenes: scene_snapshots,
        artifacts: artifact_snapshots,
        builds: build_snapshots,
        projects: project_snapshots,
        context_corrections: correction_snapshots,
        recent_feedback: feedback_snapshots,
        capabilities: SurfaceActions::Registry.ids,
        renderers: SurfaceRenderers::Registry.ids
      }
      Result.rebudget(unbounded_state, budget: @budget)
    end

    private

    def current_work_snapshot
      scene = @active_conversation&.primary_scene || Scene.continue_scene
      return unless scene

      {
        id: scene.id,
        scene_key: scene.scene_key,
        kind: scene.kind,
        status: scene.status,
        title: scene.title,
        summary: scene.summary.to_s.truncate(1_000),
        desired_outcome: scene.desired_outcome.to_s.truncate(1_000),
        resolution_summary: scene.resolution_summary.to_s.truncate(1_000),
        project_id: scene.project_id,
        context_id: scene.context_id,
        conversation_id: scene.conversation_id,
        resolved_artifact_id: scene.resolved_artifact_id,
        updated_at: scene.updated_at&.iso8601
      }
    end

    def scene_snapshots
      Scene.recent.limit(MAX_SCENES).map do |scene|
        {
          id: scene.id,
          scene_key: scene.scene_key,
          kind: scene.kind,
          status: scene.status,
          title: scene.title,
          summary: scene.summary.to_s.truncate(700),
          desired_outcome: scene.desired_outcome.to_s.truncate(700),
          resolution_summary: scene.resolution_summary.to_s.truncate(700),
          project_id: scene.project_id,
          context_id: scene.context_id,
          conversation_id: scene.conversation_id,
          resolved_artifact_id: scene.resolved_artifact_id,
          metadata: scene.metadata.to_h.deep_symbolize_keys,
          last_presented_at: scene.last_presented_at&.iso8601,
          created_at: scene.created_at&.iso8601,
          updated_at: scene.updated_at&.iso8601
        }
      end
    end

    def artifact_snapshots
      Artifact.recent.limit(MAX_ARTIFACTS).map do |artifact|
        {
          id: artifact.id,
          scene_id: artifact.scene_id,
          kind: artifact.kind,
          status: artifact.status,
          title: artifact.title,
          content: artifact.content.to_s.truncate(1_000),
          project_id: artifact.project_id,
          context_id: artifact.context_id,
          conversation_id: artifact.conversation_id,
          build_id: artifact.build_id,
          created_at: artifact.created_at&.iso8601
        }
      end
    end

    def build_snapshots
      Build.order(updated_at: :desc).limit(MAX_BUILDS).map do |build|
        {
          id: build.id,
          scene_id: build.scene_id,
          artifact_id: build.artifact_id,
          project_id: build.project_id,
          conversation_id: build.conversation_id,
          status: build.status,
          instructions: build.instructions.to_s.truncate(1_000),
          confirmation_summary: build.confirmation_summary.to_s.truncate(500),
          outcome_summary: build.outcome_summary.to_s.truncate(1_000),
          confirmed_at: build.confirmed_at&.iso8601,
          completed_at: build.completed_at&.iso8601,
          updated_at: build.updated_at&.iso8601
        }
      end
    end

    def provider_snapshot
      snapshot = state_provider_snapshot.deep_symbolize_keys
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

    def state_provider_snapshot
      parameters = @state_provider.method(:snapshot).parameters
      accepts_keywords = parameters.any? { |kind, _name| kind.in?([ :key, :keyreq, :keyrest ]) }
      return @state_provider.snapshot unless accepts_keywords

      @state_provider.snapshot(query: retrieval_query)
    end

    def retrieval_query
      intent_text = @active_intent&.input_text.to_s.squish
      return intent_text.truncate(500) if intent_text.present?

      user_message = @active_conversation&.messages&.ordered&.reverse&.find { |message| message.role == "user" }
      return user_message.content.to_s.squish.truncate(500) if user_message&.content.present?

      scene = @active_conversation&.primary_scene || Scene.continue_scene
      return if scene.nil?

      [ scene.title, scene.desired_outcome ].compact_blank.join(". ").squish.truncate(500).presence
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
      Project.active.order(updated_at: :desc).limit(MAX_PROJECTS).map do |project|
        {
          id: project.id,
          name: project.name,
          description: project.description.to_s.truncate(500),
          updated_at: project.updated_at&.iso8601,
          decisions: project.decisions.order(created_at: :desc).limit(MAX_MEMORIES_PER_PROJECT).reverse.map do |decision|
            {
              id: decision.id,
              content: decision.content.to_s.truncate(500),
              confidence: decision.confidence,
              source_message_id: decision.source_message_id,
              created_at: decision.created_at&.iso8601
            }
          end,
          beliefs: project.beliefs.order(updated_at: :desc).limit(MAX_MEMORIES_PER_PROJECT).reverse.map do |belief|
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
        scene_id: @active_conversation.primary_scene&.id,
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
        interpretation: @active_intent.interpretation,
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
        items: surface.items.first(3).map { |item| surface_item_snapshot(item) },
        recent_items: Surface.newest_first.limit(4).flat_map do |recent|
          recent.items.map { |item| surface_item_snapshot(item) }
        end
      }
    end

    def surface_item_snapshot(item)
      {
        id: item.item_key,
        scene_id: item.scene_id,
        kind: item.kind,
        title: item.title,
        state: item.state,
        context_refs: item.context_refs,
        source_refs: item.source_refs
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
          scene_id: feedback.surface_item&.scene_id,
          signal: feedback.signal,
          created_at: feedback.created_at.iso8601
        }
      end
    end
  end
end
