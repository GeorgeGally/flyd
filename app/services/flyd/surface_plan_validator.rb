require "set"

module Flyd
  class SurfacePlanValidator
    ValidationError = Class.new(StandardError)
    MAX_ITEMS = 3
    MAX_TITLE = 180
    MAX_SUMMARY = 2_000
    MAX_METADATA_CHARACTERS = 20_000
    ALLOWED_BEHAVIOURS = %w[join yield recede leave replace collapse return].freeze
    ALLOWED_MODES = %w[quiet conversation decision investigation action monitoring discovery idle interaction build].freeze
    MODE_LIMITS = {
      "quiet" => 1,
      "conversation" => 2,
      "decision" => 3,
      "investigation" => 3,
      "action" => 3,
      "monitoring" => 2,
      "discovery" => 12,
      "idle" => 1,
      "interaction" => 2,
      "build" => 3
    }.freeze

    def self.call(payload:, reference_registry:, allowed_modes: nil)
      new(payload:, reference_registry:, allowed_modes:).call
    end

    def initialize(payload:, reference_registry:, allowed_modes:)
      @payload = payload.deep_stringify_keys
      @reference_registry = reference_registry.to_set
      @allowed_modes = Array(allowed_modes).map { |mode| normalized_mode(mode) }.to_set
      @errors = []
    end

    def call
      understanding = required_text("understanding", 1_000)
      current_intention = required_text("current_intention", 600)
      mode = normalized_mode(@payload["surface_mode"].presence || "quiet")
      @errors << "Unsupported surface mode: #{mode}" unless ALLOWED_MODES.include?(mode)
      if @allowed_modes.any? && !@allowed_modes.include?(mode)
        @errors << "Surface mode #{mode} is not justified by the current situation"
      end

      raw_items = Array(@payload["items"])
      limit = MODE_LIMITS.fetch(mode, MAX_ITEMS)
      @errors << "#{mode.humanize} surface supports at most #{limit} items" if raw_items.length > limit
      items = raw_items.first(limit).map { |item| validate_item(item) }
      @errors << "Surface requires at least one item" if items.empty?
      ids = items.map { |item| item.fetch("id") }
      @errors << "Surface item ids must be unique" unless ids.uniq.length == ids.length

      focus = @payload["focus_item_id"]
      @errors << "Focus item does not exist" if focus.present? && !ids.include?(focus.to_s)
      focus ||= ids.first

      relationships = Array(@payload["relationships"]).map { |relationship| validate_relationship(relationship, ids) }
      items.each { |item| validate_renderer_action_contract(item) }
      validate_mode_grammar(mode, items.find { |item| item["id"] == focus.to_s })
      raise ValidationError, @errors.join("; ") if @errors.any?

      {
        "understanding" => understanding,
        "current_intention" => current_intention,
        "surface_mode" => mode,
        "focus_item_id" => focus,
        "items" => items,
        "relationships" => relationships
      }
    end

    private

    def normalized_mode(mode)
      { "idle" => "quiet", "interaction" => "conversation", "build" => "action" }.fetch(mode.to_s, mode.to_s)
    end

    def validate_item(item)
      item = item.to_h.deep_stringify_keys
      id = item["id"].to_s
      kind = item["kind"].to_s
      renderer = item["renderer"].to_s
      title = item["title"].to_s
      summary = item["summary"].to_s

      @errors << "Item id is required" if id.blank?
      @errors << "Item title is required for #{id}" if title.blank?
      @errors << "Item summary is required for #{id}" if summary.blank?
      @errors << "Unsupported kind: #{kind}" unless SurfaceItem::KINDS.include?(kind)
      @errors << "Unsupported intent: #{item["intent"]}" unless SurfaceItem::INTENTS.include?(item["intent"].to_s)
      @errors << "Unsupported renderer: #{renderer} for #{kind}" unless SurfaceRenderers::Registry.supported?(renderer, kind: kind)
      @errors << "Unsupported depth: #{item["depth"]}" unless SurfaceItem::DEPTHS.include?(item["depth"].to_s)

      context_refs = valid_refs(item["context_refs"], allowed_types: %w[project context])
      source_refs = valid_refs(item["source_refs"])

      {
        "id" => id,
        "kind" => kind,
        "intent" => item["intent"].to_s,
        "title" => title.truncate(MAX_TITLE),
        "summary" => summary.truncate(MAX_SUMMARY),
        "renderer" => renderer,
        "depth" => item["depth"].to_s,
        "state" => "presented",
        "context_refs" => context_refs,
        "source_refs" => source_refs,
        "actions" => valid_actions(item["actions"]),
        "metadata" => valid_metadata(renderer, item["metadata"], source_refs)
      }
    end

    def valid_refs(refs, allowed_types: nil)
      Array(refs).first(20).map do |ref|
        ref = ref.to_h.deep_stringify_keys
        type = ref["type"].to_s
        identifier = ref["id"]
        key = "#{type}:#{identifier}"
        @errors << "Reference type is required" if type.blank?
        @errors << "Reference id is required for #{type}" if identifier.blank?
        @errors << "Unsupported context reference type: #{type}" if allowed_types && !allowed_types.include?(type)
        @errors << "Unknown reference: #{key}" unless @reference_registry.include?(key)
        { "type" => type, "id" => identifier }
      end
    end

    def valid_actions(actions)
      Array(actions).first(8).map do |action|
        action = action.to_h.deep_stringify_keys
        id = action["id"].to_s
        @errors << "Unsupported action: #{id}" unless SurfaceActions::Registry.supported?(id)
        payload = begin
          SurfaceActions::Registry.sanitize_payload(id, action["payload"], reference_registry: @reference_registry)
        rescue ArgumentError => error
          @errors << error.message
          {}
        end
        {
          "id" => id,
          "label" => (action["label"].presence || id.humanize).to_s.truncate(80),
          "payload" => payload
        }
      end
    end

    def valid_metadata(renderer, metadata, source_refs)
      metadata = metadata.to_h.deep_stringify_keys
      sanitized = case renderer
      when "code"
        { "language" => metadata["language"].to_s.truncate(40) }.compact_blank
      when "data_table"
        columns = Array(metadata["columns"]).first(12).map { |column| column.to_s.truncate(80) }
        rows = Array(metadata["rows"]).first(50).map do |row|
          Array(row).first(columns.length).map { |value| value.to_s.truncate(500) }
        end
        { "columns" => columns, "rows" => rows }
      when "media"
        media_type = metadata["media_type"].to_s
        attachment_id = metadata["attachment_id"]
        @errors << "Unsupported media type: #{media_type}" unless %w[image audio file].include?(media_type)
        source_keys = source_refs.map { |ref| "#{ref["type"]}:#{ref["id"]}" }
        attachment_key = "intent_attachment:#{attachment_id}"
        @errors << "Media attachment must be an explicit source reference" unless source_keys.include?(attachment_key)
        { "media_type" => media_type, "attachment_id" => attachment_id }
      when "decision_scene"
        source_keys = source_refs.map { |ref| "#{ref["type"]}:#{ref["id"]}" }
        options = Array(metadata["options"]).first(4).map do |option|
          option = option.to_h.deep_stringify_keys
          attachment_id = option["attachment_id"].presence
          if attachment_id.present? && !source_keys.include?("intent_attachment:#{attachment_id}")
            @errors << "Decision option media must be an explicit source reference"
          end
          {
            "id" => option["id"].to_s.truncate(80),
            "label" => option["label"].to_s.truncate(180),
            "description" => option["description"].to_s.truncate(500),
            "attachment_id" => attachment_id
          }.compact
        end
        @errors << "Decision scene requires 2-4 options" unless options.length.between?(2, 4)
        @errors << "Decision option ids and labels are required" if options.any? { |option| option["id"].blank? || option["label"].blank? }
        {
          "options" => options,
          "recommendation" => metadata["recommendation"].to_s.truncate(600)
        }.compact_blank
      when "investigation_scene"
        known = Array(metadata["known"]).first(6).map { |value| value.to_s.truncate(500) }
        unknown = Array(metadata["unknown"]).first(6).map { |value| value.to_s.truncate(500) }
        next_question = metadata["next_question"].to_s.truncate(600)
        @errors << "Investigation scene requires a next question" if next_question.blank?
        @errors << "Investigation scene must distinguish known or unknown evidence" if known.empty? && unknown.empty?
        { "known" => known, "unknown" => unknown, "next_question" => next_question }
      when "action_scene"
        proposed_action = metadata["proposed_action"].to_s.truncate(1_000)
        impact = metadata["impact"].to_s.truncate(700)
        readiness = metadata["readiness"].to_s
        @errors << "Action scene requires proposed work" if proposed_action.blank?
        @errors << "Unsupported action readiness: #{readiness}" unless %w[ready blocked running].include?(readiness)
        { "proposed_action" => proposed_action, "impact" => impact, "readiness" => readiness }
      when "discovery_scene"
        {
          "why_it_matters" => metadata["why_it_matters"].to_s.truncate(700),
          "source_label" => metadata["source_label"].to_s.truncate(120),
          "provenance" => metadata["provenance"].to_s.truncate(300),
          "variant" => metadata["variant"].to_s.in?(%w[activity horoscope story archive]) ? metadata["variant"].to_s : nil
        }.compact_blank
      when "task_orientation", "task_plan", "worker_monitor", "task_review", "task_completion"
        task_revision = Integer(metadata["task_revision"], exception: false)
        @errors << "Task renderer requires a non-negative task revision" unless task_revision && task_revision >= 0
        source_types = source_refs.map { |reference| reference["type"] }
        @errors << "Task renderer requires exactly one runtime task source" unless source_types.count("runtime_task") == 1
        { "task_revision" => task_revision }.compact
      else
        {}
      end

      @errors << "Renderer metadata is too large" if JSON.generate(sanitized).length > MAX_METADATA_CHARACTERS
      sanitized
    end

    def validate_mode_grammar(mode, focus)
      return @errors << "Focus item is required" unless focus

      case mode
      when "quiet"
        @errors << "Quiet surface must use a calm hero scene" unless focus["renderer"] == "hero_scene"
      when "conversation"
        @errors << "Conversation surface must focus conversation" unless focus["renderer"] == "conversation"
      when "decision"
        @errors << "Decision surface must focus a decision scene" unless focus["renderer"].in?(%w[decision_scene task_plan])
      when "investigation"
        @errors << "Investigation surface must focus an investigation scene" unless focus["renderer"].in?(%w[investigation_scene task_review])
      when "action"
        @errors << "Action surface must focus an action scene" unless focus["renderer"].in?(%w[action_scene task_orientation task_review task_completion])
      when "monitoring"
        @errors << "Monitoring surface must focus a notification" unless focus["renderer"].in?(%w[notification worker_monitor])
      when "discovery"
        @errors << "Discovery surface must focus a discovery scene" unless focus["renderer"] == "discovery_scene"
        @errors << "Discovery requires grounded source evidence" if focus["source_refs"].empty?
      end
    end

    def validate_renderer_action_contract(item)
      case item["renderer"]
      when "decision_scene"
        validate_decision_actions(item)
      when "investigation_scene"
        validate_investigation_action(item)
      when "action_scene"
        validate_build_action(item)
      when "task_orientation", "task_plan", "worker_monitor", "task_review", "task_completion"
        validate_task_actions(item)
      end
    end

    def validate_task_actions(item)
      source_keys = item["source_refs"].map { |reference| "#{reference["type"]}:#{reference["id"]}" }.to_set
      item["actions"].each do |action|
        payload = action["payload"]
        if payload["task_key"].present? && !source_keys.include?("runtime_task:#{payload["task_key"]}")
          @errors << "Task action must bind to the displayed runtime task"
        end
        if payload["grant_key"].present? && !source_keys.include?("task_grant:#{payload["grant_key"]}")
          @errors << "Task grant action must bind to a displayed grant"
        end
        if payload["worker_key"].present? && !source_keys.include?("worker_session:#{payload["worker_key"]}")
          @errors << "Worker action must bind to a displayed worker"
        end
        if payload["task_revision"].present? && payload["task_revision"] != item.dig("metadata", "task_revision")
          @errors << "Task action revision must match the displayed task revision"
        end
      end

      return unless item["renderer"] == "task_plan"

      approve = item["actions"].count { |action| action["id"] == "approve_task_grant" }
      reject = item["actions"].count { |action| action["id"] == "reject_task_grant" }
      @errors << "Task plan requires exactly one approve and one reject action" unless approve == 1 && reject == 1
    end

    def validate_decision_actions(item)
      options = Array(item.dig("metadata", "options"))
      option_ids = options.map { |option| option["id"] }
      choose_actions = item["actions"].select { |action| action["id"] == "choose" }

      @errors << "Decision option ids must be unique" unless option_ids.uniq.length == option_ids.length

      action_matches = options.to_h do |option|
        [ option["id"], choose_actions.select { |action| action.dig("payload", "option_id") == option["id"] } ]
      end
      @errors << "Each decision option requires exactly one choose action" unless action_matches.values.all?(&:one?)

      options.each do |option|
        matching = action_matches.fetch(option["id"], [])
        next unless matching.one?

        if matching.first.dig("payload", "option_label") != option["label"]
          @errors << "Decision action label must match its displayed option"
        end
      end

      if choose_actions.any? { |action| !option_ids.include?(action.dig("payload", "option_id")) }
        @errors << "Decision choose actions must reference a displayed option"
      end
    end

    def validate_investigation_action(item)
      investigate_actions = item["actions"].select { |action| action["id"] == "investigate" }
      unless investigate_actions.one?
        @errors << "Investigation surface requires exactly one investigate action"
        return
      end

      if investigate_actions.first.dig("payload", "question") != item.dig("metadata", "next_question")
        @errors << "Investigation action must match the displayed next question"
      end
    end

    def validate_build_action(item)
      readiness = item.dig("metadata", "readiness")
      build_actions = item["actions"].select { |action| action["id"] == "build" }

      if readiness == "ready"
        unless build_actions.one?
          @errors << "Ready action surface requires exactly one build action"
          return
        end

        if build_actions.first.dig("payload", "instructions") != item.dig("metadata", "proposed_action")
          @errors << "Build instructions must match the displayed proposed work"
        end
      elsif build_actions.any?
        @errors << "Blocked or running action surfaces must not offer a build action"
      end
    end

    def validate_relationship(relationship, ids)
      relationship = relationship.to_h.deep_stringify_keys
      from = relationship["from"].to_s
      to = relationship["to"].to_s
      behaviour = relationship["behaviour"].to_s
      @errors << "Unknown relationship source: #{from}" unless ids.include?(from)
      @errors << "Unknown relationship target: #{to}" unless ids.include?(to)
      @errors << "Unsupported relationship behaviour: #{behaviour}" unless ALLOWED_BEHAVIOURS.include?(behaviour)
      { "from" => from, "to" => to, "behaviour" => behaviour, "reason" => relationship["reason"].to_s.truncate(300) }
    end

    def required_text(key, limit)
      value = @payload[key].to_s
      @errors << "#{key} is required" if value.blank?
      value.truncate(limit)
    end
  end
end
