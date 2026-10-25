module Surfaces
  class PersistPlan
    def self.call(plan:, source_state_digest: nil, composition_version: "1", active_conversation: nil, active_intent: nil)
      new(
        plan: plan,
        source_state_digest: source_state_digest,
        composition_version: composition_version,
        active_conversation: active_conversation,
        active_intent: active_intent
      ).call
    end

    def initialize(plan:, source_state_digest:, composition_version:, active_conversation:, active_intent:)
      @plan = plan
      @source_state_digest = source_state_digest
      @composition_version = composition_version
      @active_conversation = active_conversation
      @active_intent = active_intent
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
          scene = persist_scene(item)
          surface_item = surface.surface_items.create!(
            scene: scene,
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
          persist_task_recommendation(surface_item)
        end

        surface
      end
    end

    private

    def persist_task_recommendation(item)
      task_ref = Array(item.source_refs).map { |ref| ref.to_h.deep_stringify_keys }
        .find { |ref| ref["type"] == "runtime_task" }
      return unless task_ref

      task = AgentTask.find_by(task_key: task_ref["id"])
      revision = Integer(item.metadata["task_revision"], exception: false)
      return unless task && revision == task.revision

      action = Array(item.actions).map { |entry| entry.to_h.deep_stringify_keys }
        .find { |entry| RuntimeTasks::ActionExecutor::TASK_ACTIONS.include?(entry["id"]) }
      return unless action

      digest = Digest::SHA256.hexdigest(JSON.generate(action))
      TaskRecommendation.find_or_create_by!(surface_item: item, action_digest: digest) do |recommendation|
        recommendation.agent_task = task
        recommendation.release_key = "release_1c"
        recommendation.task_revision = revision
        recommendation.action_id = action.fetch("id")
        recommendation.action = action["label"].presence || action.fetch("id")
        recommendation.metadata = { "renderer" => item.renderer, "surface_id" => item.surface_id }
      end
    end

    def persist_scene(item)
      scene = Scene.find_or_initialize_by(scene_key: item.id)
      project, context = context_owner(item.context_refs)
      conversation = conversation_for(item, project, context)
      intent = intent_for(item)

      scene.assign_attributes(
        title: item.title,
        summary: item.summary,
        desired_outcome: item.summary,
        kind: scene_kind(item),
        project: project || scene.project,
        context: context || scene.context,
        conversation: conversation || scene.conversation,
        intent: intent || scene.intent,
        last_presented_at: Time.current,
        status: scene.status == "dismissed" ? "dismissed" : "active"
      )
      scene.save!
      scene
    end

    def context_owner(refs)
      reference = Array(refs).find { |ref| %w[project context].include?(value(ref, :type)) }
      return [ nil, nil ] unless reference

      case value(reference, :type)
      when "project" then [ Project.active.find_by(id: value(reference, :id)), nil ]
      when "context" then [ nil, Context.active.find_by(id: value(reference, :id)) ]
      else [ nil, nil ]
      end
    end

    def conversation_for(item, project, context)
      reference = Array(item.source_refs).find { |ref| value(ref, :type) == "conversation" }
      explicit = Conversation.find_by(id: value(reference, :id)) if reference
      return explicit if explicit
      return unless @active_conversation
      return @active_conversation if project && @active_conversation.project_id == project.id
      return @active_conversation if context && @active_conversation.context_id == context.id

      @active_conversation if item.renderer == "conversation"
    end

    def intent_for(item)
      reference = Array(item.source_refs).find { |ref| value(ref, :type) == "intent" }
      explicit = Intent.find_by(id: value(reference, :id)) if reference
      explicit || @active_intent
    end

    def scene_kind(item)
      return "build" if item.intent == "build"
      return "investigation" if item.intent == "investigate"

      {
        "question" => "question",
        "decision" => "decision",
        "conversation" => "conversation",
        "notification" => "monitoring"
      }.fetch(item.kind, "work")
    end

    def value(hash, key)
      return unless hash

      hash[key.to_s] || hash[key.to_sym]
    end
  end
end
