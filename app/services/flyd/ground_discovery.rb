module Flyd
  class GroundDiscovery
    def self.call(payload:, state:)
      new(payload:, state:).call
    end

    def initialize(payload:, state:)
      @payload = payload.deep_stringify_keys
      @state = state.deep_symbolize_keys
    end

    def call
      @payload = directed_payload if directed_discovery?
      return @payload unless @payload["surface_mode"] == "discovery"

      item = Array(@payload["items"]).find { |candidate| candidate["id"].to_s == @payload["focus_item_id"].to_s }
      return @payload unless item

      apply_directed_reference(item)
      evidence = evidence_for(Array(item["source_refs"]).first)
      return @payload unless evidence

      content = evidence[:content].to_h.deep_symbolize_keys
      item["title"] = content[:title].to_s if content[:title].present?
      item["metadata"] = item["metadata"].to_h
      if evidence[:type].to_s == "discovery"
        ground_current_story(item, content)
      else
        ground_archive_item(item, content)
      end
      @payload
    end

    private

    def directed_discovery?
      @state.dig(:interface_direction, :suggested_mode).to_s == "discovery" && directed_reference.present?
    end

    def directed_payload
      reference = directed_reference.deep_stringify_keys
      item_id = "surface:#{reference.fetch("id")}"
      {
        "understanding" => "A grounded discovery is worth bringing into view.",
        "current_intention" => "Present one exact discovery without embellishment.",
        "surface_mode" => "discovery",
        "focus_item_id" => item_id,
        "items" => [ {
          "id" => item_id,
          "kind" => "insight",
          "intent" => "inform",
          "title" => "Discovery",
          "summary" => "Grounded evidence selected by Flyd.",
          "renderer" => "discovery_scene",
          "depth" => "foreground",
          "context_refs" => [],
          "source_refs" => [ reference ],
          "actions" => [ { "id" => "discuss", "label" => "Discuss this discovery", "payload" => {} } ],
          "metadata" => {}
        } ],
        "relationships" => []
      }
    end

    def directed_reference
      candidate = Array(@state.dig(:interface_direction, :candidates)).find { |value| value[:mode].to_s == "discovery" }
      Array(candidate&.dig(:evidence_refs)).first
    end

    def evidence_for(reference)
      reference = reference.to_h.deep_symbolize_keys
      providers.flat_map { |provider| provider[:data].to_h.values.flatten }.find do |item|
        item = item.to_h.deep_symbolize_keys
        item[:type].to_s == reference[:type].to_s && item[:id].to_s == reference[:id].to_s
      end&.deep_symbolize_keys
    end

    def providers
      Array(@state.dig(:provider_state, :providers))
    end

    def apply_directed_reference(item)
      reference = directed_reference
      item["source_refs"] = [ reference.deep_stringify_keys ] if reference.present?
    end

    def ground_current_story(item, content)
      facts = []
      facts << "#{content[:score].to_i} points" if content[:score].present?
      facts << "#{content[:comments].to_i} comments" if content[:comments].present?
      facts << "Published #{formatted_date(content[:publishedAt] || content[:published_at])}" if content[:publishedAt].present? || content[:published_at].present?
      item["summary"] = content[:description].presence || content[:excerpt].presence || facts.join(" · ").presence || item["title"]
      item["metadata"]["source_label"] = [ "Current story", content[:sourceName] || content[:source_name] ].compact_blank.join(" · ")
      item["metadata"]["provenance"] = facts.join(" · ") if facts.any?
      reason = content[:relevanceReason] || content[:relevance_reason] || "From current stories"
      item["metadata"]["why_it_matters"] = reason
      @payload["understanding"] = current_story_understanding(reason)
      @payload["current_intention"] = "Bring one relevant current discovery into view."
    end

    def ground_archive_item(item, content)
      excerpt = content[:excerpt].presence || content[:summary].presence
      item["summary"] = readable_markdown(excerpt) if excerpt.present?
      item["metadata"]["source_label"] = "From your archive"
      @payload["understanding"] = "A useful idea from your archive is worth revisiting."
      @payload["current_intention"] = "Reconnect current attention with grounded personal knowledge."
    end

    def current_story_understanding(reason)
      detail = reason.to_s.sub(/\AMatches/, "matches").sub(/\AFrom/, "comes from")
      "A current story #{detail}."
    end

    def readable_markdown(value)
      html = Commonmarker.to_html(value.to_s, options: { render: { unsafe: false } })
      ActionView::Base.full_sanitizer.sanitize(html).squish.truncate(1_000)
    end

    def formatted_date(value)
      Time.zone.parse(value.to_s).strftime("%-d %b %Y")
    rescue ArgumentError, TypeError
      value.to_s
    end
  end
end
