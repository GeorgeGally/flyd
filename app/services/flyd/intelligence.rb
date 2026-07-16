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
      compiled = apply_interface_direction(compiled)
      if intentionally_quiet?(compiled.state)
        @diagnostics = compiled.diagnostics.merge(
          state_digest: IntelligenceSnapshot.digest_for(compiled.state.except(:generated_at)),
          provider_snapshots: provider_snapshots(compiled.state),
          output_characters: 0,
          latency_ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1_000).round
        )
        return quiet_surface
      end

      response = @chat.call!(messages(compiled.state))
      responses = [ response ]
      payload = parse_json(response)
      payload = GroundDiscovery.call(payload: payload, state: compiled.state)
      allowed_modes = Array(compiled.state.dig(:interface_direction, :candidates)).map { |candidate| candidate[:mode] }
      validated = begin
        validate_payload(payload, compiled.reference_registry, allowed_modes)
      rescue SurfacePlanValidator::ValidationError => error
        repair_response = @chat.call!(repair_messages(compiled.state, payload, error))
        responses << repair_response
        repaired_payload = parse_json(repair_response)
        repaired_payload = GroundDiscovery.call(payload: repaired_payload, state: compiled.state)
        validate_payload(repaired_payload, compiled.reference_registry, allowed_modes)
      end
      @diagnostics = compiled.diagnostics.merge(
        state_digest: IntelligenceSnapshot.digest_for(compiled.state.except(:generated_at)),
        provider_snapshots: provider_snapshots(compiled.state),
        output_characters: responses.sum { |value| value.to_s.length },
        latency_ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1_000).round
      )
      build_surface(validated)
    rescue Llm::Chat::Error, JSON::ParserError, KeyError, ArgumentError, StateBudget::BudgetExceeded, SurfacePlanValidator::ValidationError => error
      Rails.logger.warn("Flyd surface composition failed: #{error.message}")
      raise unless @fallback

      fallback_surface
    end

    private

    def apply_interface_direction(compiled)
      directed = compiled.state.merge(interface_direction: InterfaceDirector.call(compiled.state))
      budget = compiled.diagnostics[:budget] || WorldStateExtensions::MAX_TOTAL_CHARACTERS
      WorldStateCompiler::Result.rebudget(
        directed,
        budget: budget,
        diagnostics: compiled.diagnostics
      )
    end

    def provider_snapshots(state)
      Array(state.dig(:provider_state, :providers)).map do |provider|
        {
          "source" => provider[:source],
          "snapshot_id" => provider[:snapshot_id],
          "state_digest" => provider[:state_digest],
          "fresh" => provider[:fresh]
        }
      end
    end

    def intentionally_quiet?(state)
      Array(state.dig(:interface_direction, :candidates)).map { |candidate| candidate[:mode].to_s } == [ "quiet" ]
    end

    def messages(state)
      [
        { role: "system", content: system_prompt },
        { role: "user", content: JSON.generate(state) }
      ]
    end

    def repair_messages(state, payload, error)
      required_mode = state.dig(:interface_direction, :suggested_mode).to_s
      [
        {
          role: "system",
          content: <<~PROMPT
            #{system_prompt}
            Correct one structurally invalid surface plan and return the complete corrected JSON object.
            Required surface mode: #{required_mode}.
            Do not choose an alternative mode. Use the required mode's grammar and preserve its exact candidate evidence references.
          PROMPT
        },
        {
          role: "user",
          content: JSON.generate(
            state: state,
            invalid_payload: payload,
            validation_errors: error.message
          )
        }
      ]
    end

    def validate_payload(payload, reference_registry, allowed_modes)
      SurfacePlanValidator.call(
        payload: payload,
        reference_registry: reference_registry,
        allowed_modes: allowed_modes
      )
    end

    def system_prompt
      <<~PROMPT
        You are Flyd. You are the intelligence and the director of the interface—not a classifier, feed ranker, dashboard builder, or chat wrapper.

        First decide what kind of moment this is. Then generate the precise interface needed to resolve it. Do not default to reopening the last conversation. Continuity is evidence, not the product.

        The supplied interface_direction contains a suggested mode, alternatives, and strict interface grammars. You may choose a different candidate when the evidence supports it, but you must obey the grammar for the mode you choose.

        Quiet is valid only when no candidate evidence supports a concrete present situation. Inspect each candidate evidence_refs list, synthesize the referenced evidence into the interface, and preserve the exact references on the generated items. Candidate confidence is guidance, not a substitute for your judgment.

        Available modes:
        - quiet: almost nothing; no manufactured urgency.
        - conversation: dialogue is genuinely the best next move.
        - decision: the choice itself becomes the screen.
        - investigation: show what is known, what is uncertain, and the next question.
        - action: show proposed work, likely impact, and the confirmation boundary.
        - monitoring: show a changing condition and what would make it actionable.
        - discovery: compose up to three grounded objects from recent work, a personal daily signal, and fresh external stories without manufacturing urgency.

        Synthesize across evidence; never expose records merely because they exist. Goals, tensions, signals, memories, projects, scenes, artifacts, builds, reports, conversations, media attachments, contexts, and feedback are evidence—not UI objects.

        Learned surface preferences are soft evidence from outcomes. Use them only when they improve the present experience. Never mechanically rank or suppress meaning because of them.

        Return JSON only:
        {
          "understanding": "concise synthesis",
          "current_intention": "what Flyd is trying to accomplish",
          "surface_mode": "quiet|conversation|decision|investigation|action|monitoring|discovery",
          "focus_item_id": "semantic item id",
          "items": [{
            "id": "reuse a durable scene_key when continuing existing work; otherwise create a stable semantic id",
            "kind": "scene|insight|decision|question|conversation|artifact|reminder|status|notification",
            "intent": "inform|ask|decide|discuss|investigate|monitor|remind|review|celebrate|build",
            "title": "editorial title",
            "summary": "synthesized content",
            "renderer": "hero_scene|supporting_card|conversation|document|notification|code|data_table|media|decision_scene|investigation_scene|action_scene|discovery_scene",
            "depth": "foreground|middle|background|receded",
            "context_refs": [{"type":"project|context","id":1}],
            "source_refs": [{"type":"exact evidence type from state","id":"exact id from state"}],
            "actions": [{"id":"choose|investigate|build|discuss|answer|dismiss|resolve|inspect_sources|correct_context","label":"Action label","payload":{}}],
            "metadata": {
              "options": [{"id":"option-id","label":"Choice","description":"consequence","attachment_id":"optional exact intent attachment id"}],
              "recommendation": "optional recommendation; when present the recommended option must be first in options",
              "known": ["known fact"],
              "unknown": ["important uncertainty"],
              "next_question": "question Flyd should investigate",
              "proposed_action": "work Flyd is ready to perform",
              "impact": "what changes if confirmed",
              "readiness": "ready|blocked|running",
              "why_it_matters": "grounded connection to the user's work or interests",
              "source_label": "From your archive|Current story"
            }
          }],
          "relationships": [{
            "from": "semantic-item-id",
            "to": "semantic-item-id",
            "behaviour": "join|yield|recede|leave|replace|collapse|return",
            "reason": "brief semantic reason"
          }]
        }

        Grammar requirements:
        - decision: focus renderer decision_scene, 2-4 options, and exactly one choose action for each option. Every choose payload must contain the exact displayed option id and label. When recommending an option, place it first in metadata.options; the editorial renderer gives the first option recommendation emphasis only when recommendation is present. When an option corresponds to supplied image evidence, bind its exact intent attachment id as attachment_id and include that same intent_attachment reference in source_refs so the real object becomes the interface.
        - investigation: focus kind must be question, insight, or scene; focus renderer investigation_scene; include known/unknown evidence and a next_question; investigate action payload must be {"question":"metadata.next_question"}.
        - action: focus renderer action_scene. When readiness is ready, include exactly one build action whose instructions exactly equal metadata.proposed_action. When readiness is blocked or running, include no build action. Never imply execution before confirmation.
        - conversation: focus renderer conversation when no live conversation is already supplied; at most one supporting item.
        - quiet: exactly one calm focus item and no action unless the user must genuinely respond.
        - monitoring: at most two items and a precise trigger for future action.
        - discovery: one to three insights or artifacts using discovery_scene, each with an exact source reference. Prefer a mix of recent personal activity, today's horoscope, and current stories when supplied. Preserve facts, names, dates, and links from the evidence; do not embellish them.

        Never use a provider evidence type such as goal, tension, signal, curiosity, nudge, report, or event as an item kind. Use only the item kinds listed in the JSON contract. Maximum three items, except conversation and monitoring allow at most two, and quiet exactly one. Item ids are created by you or reused from existing scene_key values. Context and source references must use exact ids present in the supplied state. Media attachment ids must also appear as explicit intent_attachment source references. Do not include private reasoning.
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
      quiet_surface(
        understanding: "Flyd could not compose a contextual surface.",
        current_intention: "Remain available without fabricating relevance."
      )
    end

    def quiet_surface(
      understanding: "Flyd is ready when you are.",
      current_intention: "Stay available without inventing urgency."
    )
      item = SurfaceItem.new(
        id: "quiet:available", kind: "scene", intent: "discuss",
        title: "Ready when you are.",
        summary: "Ask, tell, or show Flyd what changed.",
        renderer: "hero_scene", depth: "foreground", state: "presented",
        context_refs: [], source_refs: [], actions: [], relationships: [], metadata: {}
      )

      Surface.new(
        generated_at: Time.current,
        understanding: understanding,
        current_intention: current_intention,
        surface_mode: "quiet",
        focus_item_id: item.id,
        items: [ item ],
        relationships: []
      )
    end
  end
end
