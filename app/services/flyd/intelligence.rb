require "json"

module Flyd
  class Intelligence
    SurfaceItem = Data.define(
      :id, :kind, :intent, :title, :summary, :renderer, :depth,
      :state, :context_refs, :source_refs, :actions, :relationships, :metadata
    )
    Surface = Data.define(
      :generated_at, :understanding, :current_intention, :surface_mode,
      :focus_item_id, :items, :relationships
    )

    attr_reader :diagnostics

    def self.compose_surface(active_conversation: nil, active_intent: nil, fallback: true)
      new(active_conversation:, active_intent:, fallback:).compose_surface
    end

    def initialize(active_conversation: nil, active_intent: nil, chat: Llm::Chat.new, state_provider: IntelligenceState::Registry, fallback: true)
      @active_conversation = active_conversation
      @active_intent = active_intent
      @chat = chat
      @state_provider = state_provider
      @fallback = fallback
      @diagnostics = {}
    end

    def compose_surface
      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      compiled = WorldStateCompiler.call(
        active_conversation: @active_conversation,
        active_intent: @active_intent,
        state_provider: @state_provider
      )
      compiled = WorldStateExtensions.call(compiled: compiled, active_intent: @active_intent)
      response = @chat.call!(messages(compiled.state))
      payload = parse_json(response)
      validated = SurfacePlanValidator.call(payload: payload, reference_registry: compiled.reference_registry)
      @diagnostics = compiled.diagnostics.merge(
        output_characters: response.to_s.length,
        latency_ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1_000).round
      )
      build_surface(validated)
    rescue Llm::Chat::Error, JSON::ParserError, KeyError, ArgumentError, SurfacePlanValidator::ValidationError => error
      Rails.logger.warn("Flyd surface composition failed: #{error.message}")
      raise unless @fallback

      fallback_surface
    end

    private

    def messages(state)
      [
        { role: "system", content: system_prompt },
        { role: "user", content: JSON.generate(state) }
      ]
    end

    def system_prompt
      <<~PROMPT
        You are Flyd. You are the intelligence, not a classifier, feed ranker, dashboard builder, or chat wrapper.

        Decide what the user should experience now. Synthesize across evidence; never expose records merely because they exist. Goals, tensions, signals, memories, projects, reports, conversations, media attachments, contexts, and feedback are evidence, not UI objects.

        Learned surface preferences are soft evidence from outcomes. Use them only when they improve the current experience. Never mechanically rank or suppress meaning because of them.

        Return JSON only:
        {
          "understanding": "concise synthesis",
          "current_intention": "what Flyd is trying to accomplish",
          "surface_mode": "idle|interaction|decision|build|monitoring",
          "focus_item_id": "a semantic item id or null",
          "items": [{
            "id": "new semantic id",
            "kind": "scene|insight|decision|question|conversation|artifact|reminder|status|notification",
            "intent": "inform|ask|decide|discuss|investigate|monitor|remind|review|celebrate",
            "title": "editorial title",
            "summary": "synthesized content",
            "renderer": "hero_scene|supporting_card|conversation|document|notification|code|data_table|media",
            "depth": "foreground|middle|background|receded",
            "context_refs": [{"type":"project|context","id":1}],
            "source_refs": [{"type":"goal|intent_attachment","id":"goal:abc"}],
            "actions": [{"id":"discuss","label":"Discuss","payload":{}}],
            "metadata": {
              "language": "optional code language",
              "columns": ["optional", "table", "columns"],
              "rows": [["optional", "table", "rows"]],
              "media_type": "image|audio|file",
              "attachment_id": 1
            }
          }],
          "relationships": [{
            "from": "semantic-item-id",
            "to": "semantic-item-id",
            "behaviour": "join|yield|recede|leave|replace|collapse|return",
            "reason": "brief semantic reason"
          }]
        }

        Maximum three items. Item ids are created by you. Context and source references must use exact ids present in the supplied state. Only use the listed renderers and capabilities. Do not include private reasoning.
      PROMPT
    end

    def parse_json(response)
      text = response.to_s.strip
      text = text[/\{.*\}/m] || text
      JSON.parse(text)
    end

    def build_surface(payload)
      relationships = Array(payload.fetch("relationships"))
      items = Array(payload.fetch("items")).map do |item|
        item_relationships = relationships.select { |relationship| relationship["from"] == item["id"] || relationship["to"] == item["id"] }
        SurfaceItem.new(
          id: item.fetch("id"),
          kind: item.fetch("kind"),
          intent: item.fetch("intent"),
          title: item.fetch("title"),
          summary: item.fetch("summary"),
          renderer: item.fetch("renderer"),
          depth: item.fetch("depth"),
          state: item.fetch("state"),
          context_refs: item.fetch("context_refs"),
          source_refs: item.fetch("source_refs"),
          actions: item.fetch("actions"),
          relationships: item_relationships,
          metadata: item.fetch("metadata")
        )
      end

      Surface.new(
        generated_at: Time.current,
        understanding: payload.fetch("understanding"),
        current_intention: payload.fetch("current_intention"),
        surface_mode: payload.fetch("surface_mode"),
        focus_item_id: payload.fetch("focus_item_id"),
        items: items,
        relationships: relationships
      )
    end

    def fallback_surface
      item = SurfaceItem.new(
        id: "continue", kind: "scene", intent: "discuss",
        title: "What deserves your attention?",
        summary: "Tell Flyd what is happening. The surface will reorganize around the context.",
        renderer: "hero_scene", depth: "foreground", state: "presented",
        context_refs: [], source_refs: [], actions: [], relationships: [], metadata: {}
      )

      Surface.new(
        generated_at: Time.current,
        understanding: "Flyd could not compose a contextual surface.",
        current_intention: "Remain available without pretending records are intelligence.",
        surface_mode: "idle",
        focus_item_id: item.id,
        items: [ item ],
        relationships: []
      )
    end
  end
end
