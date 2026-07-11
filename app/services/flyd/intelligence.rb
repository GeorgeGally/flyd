require "json"

module Flyd
  class Intelligence
    SurfaceItem = Data.define(
      :id, :kind, :intent, :title, :summary, :renderer, :depth,
      :state, :context_refs, :source_refs, :actions
    )
    Surface = Data.define(:generated_at, :understanding, :current_intention, :focus_item_id, :items)

    ALLOWED_INTENTS = %w[inform ask decide discuss build investigate monitor remind review celebrate].freeze
    ALLOWED_RENDERERS = %w[hero_scene card conversation document build image timeline notification].freeze
    ALLOWED_DEPTHS = %w[foreground middle background receded].freeze
    ALLOWED_KINDS = %w[scene insight decision question conversation artifact build reminder status notification].freeze

    def self.compose_surface(active_conversation: nil, fallback: true)
      new(active_conversation:, fallback:).compose_surface
    end

    def initialize(active_conversation: nil, chat: Llm::Chat.new, state_provider: IntelligenceState::Registry, fallback: true)
      @active_conversation = active_conversation
      @chat = chat
      @state_provider = state_provider
      @fallback = fallback
    end

    def compose_surface
      response = @chat.call!(messages)
      build_surface(parse_json(response))
    rescue Llm::Chat::Error, JSON::ParserError, KeyError, ArgumentError => error
      Rails.logger.warn("Flyd surface composition failed: #{error.message}")
      raise unless @fallback

      fallback_surface
    end

    private

    def messages
      [
        { role: "system", content: system_prompt },
        { role: "user", content: JSON.generate(state_snapshot) }
      ]
    end

    def system_prompt
      <<~PROMPT
        You are Flyd. You are the intelligence, not a classifier, feed ranker, dashboard builder, or chat wrapper.

        Given the current state of the user's world, decide what the user should experience now. Synthesize across all evidence, including goals, tensions, curiosity, reports, nudges, events, conversations, beliefs, and decisions. Do not expose records merely because they exist. Do not create one item per project, decision, belief, signal, goal, or event.

        First determine:
        1. What is happening?
        2. What matters now?
        3. What are you trying to accomplish with the user?
        4. What representation best accomplishes that intention?

        Treat provider data as evidence. Provider freshness and errors are part of the state. Stale data may still be useful, but do not present it as current without qualification.

        Return JSON only with this shape:
        {
          "understanding": "your concise synthesis of the current situation",
          "current_intention": "what Flyd is trying to accomplish now",
          "focus_item_id": "semantic item id or null",
          "items": [
            {
              "id": "new stable semantic item id",
              "kind": "scene|insight|decision|question|conversation|artifact|build|reminder|status|notification",
              "intent": "inform|ask|decide|discuss|build|investigate|monitor|remind|review|celebrate",
              "title": "human editorial title",
              "summary": "synthesized content, not a database label",
              "renderer": "hero_scene|card|conversation|document|build|image|timeline|notification",
              "depth": "foreground|middle|background|receded",
              "context_refs": [{"type":"project","id":1}],
              "source_refs": [{"type":"goal","id":"launch-flyd"}],
              "actions": [{"id":"discuss","label":"Discuss"}]
            }
          ]
        }

        Maximum three visible items. Item ids may be newly created semantic ids. Context and source references must use ids present in the state snapshot. Use source_refs for provenance, not as the organizing principle. Do not include private reasoning.
      PROMPT
    end

    def state_snapshot
      projects = Project.active.includes(:decisions, :beliefs, conversations: :messages).order(updated_at: :desc).limit(12)

      {
        generated_at: Time.current.iso8601,
        active_interaction: conversation_snapshot,
        capabilities: %w[text conversation scene card document build notification],
        intelligence_state: @state_provider.snapshot,
        projects: projects.map { |project| project_snapshot(project) }
      }
    end

    def project_snapshot(project)
      {
        id: project.id,
        name: project.name,
        description: project.description,
        updated_at: project.updated_at&.iso8601,
        decisions: project.decisions.sort_by(&:created_at).last(8).map do |decision|
          { id: decision.id, content: decision.content, confidence: decision.confidence, created_at: decision.created_at&.iso8601 }
        end,
        beliefs: project.beliefs.sort_by(&:updated_at).last(8).map do |belief|
          { id: belief.id, statement: belief.statement, confidence: belief.confidence, status: belief.status, updated_at: belief.updated_at&.iso8601 }
        end,
        recent_messages: project.conversations.flat_map(&:messages).sort_by(&:created_at).last(10).map do |message|
          { id: message.id, role: message.role, content: message.content.to_s.truncate(600), created_at: message.created_at&.iso8601 }
        end
      }
    end

    def conversation_snapshot
      return nil unless @active_conversation

      {
        id: @active_conversation.id,
        project_id: @active_conversation.project_id,
        summary: @active_conversation.summary,
        messages: @active_conversation.messages.ordered.last(12).map do |message|
          { id: message.id, role: message.role, content: message.content.to_s.truncate(800) }
        end
      }
    end

    def parse_json(response)
      text = response.to_s.strip
      text = text[/\{.*\}/m] || text
      JSON.parse(text)
    end

    def build_surface(payload)
      items = Array(payload.fetch("items")).first(3).map { |item| build_item(item) }
      focus_id = payload["focus_item_id"]
      focus_id = items.first&.id unless items.any? { |item| item.id == focus_id }

      Surface.new(
        generated_at: Time.current,
        understanding: payload.fetch("understanding").to_s,
        current_intention: payload.fetch("current_intention").to_s,
        focus_item_id: focus_id,
        items: items
      )
    end

    def build_item(item)
      kind = allowed!(item.fetch("kind"), ALLOWED_KINDS, "kind")
      intent = allowed!(item.fetch("intent"), ALLOWED_INTENTS, "intent")
      renderer = allowed!(item.fetch("renderer"), ALLOWED_RENDERERS, "renderer")
      depth = allowed!(item.fetch("depth"), ALLOWED_DEPTHS, "depth")

      SurfaceItem.new(
        id: item.fetch("id").to_s,
        kind:, intent:,
        title: item.fetch("title").to_s,
        summary: item.fetch("summary").to_s,
        renderer:, depth:, state: "presented",
        context_refs: valid_refs(item["context_refs"]),
        source_refs: valid_refs(item["source_refs"]),
        actions: Array(item["actions"]).filter_map { |action| valid_action(action) }
      )
    end

    def allowed!(value, allowed, field)
      value = value.to_s
      raise ArgumentError, "Invalid #{field}: #{value}" unless allowed.include?(value)
      value
    end

    def valid_refs(refs)
      Array(refs).filter_map do |ref|
        next unless ref.is_a?(Hash) && ref["type"].present? && ref["id"].present?
        { type: ref["type"].to_s, id: ref["id"] }
      end
    end

    def valid_action(action)
      return unless action.is_a?(Hash) && action["id"].present? && action["label"].present?
      { id: action["id"].to_s, label: action["label"].to_s }
    end

    def fallback_surface
      item = SurfaceItem.new(
        id: "continue", kind: "scene", intent: "discuss",
        title: "What deserves your attention?",
        summary: "Tell Flyd what is happening. The surface will reorganize around the context.",
        renderer: "hero_scene", depth: "foreground", state: "presented",
        context_refs: [], source_refs: [], actions: []
      )

      Surface.new(
        generated_at: Time.current,
        understanding: "Flyd could not compose a contextual surface.",
        current_intention: "Remain available without pretending records are intelligence.",
        focus_item_id: item.id,
        items: [item]
      )
    end
  end
end
