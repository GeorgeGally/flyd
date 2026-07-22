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

      Array(@payload["items"]).each { |item| ground_item(item) }
      apply_ensemble_intention if Array(@payload["items"]).many?
      @payload
    end

    private

    def directed_discovery?
      @payload["surface_mode"] == "discovery" && directed_references.any?
    end

    def directed_payload
      items = directed_references.first(3).each_with_index.map do |raw_reference, index|
        reference = raw_reference.deep_stringify_keys
        {
          "id" => "surface:#{reference.fetch("id")}",
          "kind" => "insight",
          "intent" => "inform",
          "title" => "Discovery",
          "summary" => "Grounded evidence selected by Flyd.",
          "renderer" => "discovery_scene",
          "depth" => %w[foreground middle background].fetch(index),
          "context_refs" => [],
          "source_refs" => [ reference ],
          "actions" => actions_for(reference.fetch("type")),
          "metadata" => {}
        }
      end
      {
        "understanding" => "A grounded discovery is worth bringing into view.",
        "current_intention" => "Compose exact discoveries without embellishment.",
        "surface_mode" => "discovery",
        "focus_item_id" => items.first.fetch("id"),
        "items" => items,
        "relationships" => []
      }
    end

    def directed_references
      candidate = Array(@state.dig(:interface_direction, :candidates)).find { |value| value[:mode].to_s == "discovery" }
      Array(candidate&.dig(:evidence_refs))
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

    def ground_item(item)
      evidence = evidence_for(Array(item["source_refs"]).first)
      return unless evidence

      content = evidence[:content].to_h.deep_symbolize_keys
      item["title"] = content[:title].to_s if content[:title].present?
      item["metadata"] = item["metadata"].to_h
      case evidence[:type].to_s
      when "discovery" then ground_current_story(item, content)
      when "activity" then ground_activity(item, content)
      when "horoscope" then ground_horoscope(item, content)
      when "forecast" then ground_forecast(item, content)
      else ground_archive_item(item, content)
      end
    end

    def actions_for(type)
      return [ { "id" => "discuss", "label" => "Continue", "payload" => {} } ] if type.to_s == "activity"
      return [] if type.to_s == "horoscope"

      [ { "id" => "discuss", "label" => "Discuss", "payload" => {} } ]
    end

    def apply_ensemble_intention
      @payload["understanding"] = "Recent work, a personal daily signal, and current discoveries belong on one stage."
      @payload["current_intention"] = "Move between what you were doing, today's rhythm, and what is newly interesting."
    end

    def ground_current_story(item, content)
      facts = []
      facts << "#{content[:score].to_i} points" if content[:score].present?
      facts << "#{content[:comments].to_i} comments" if content[:comments].present?
      facts << "Published #{formatted_date(content[:publishedAt] || content[:published_at])}" if content[:publishedAt].present? || content[:published_at].present?
      item["summary"] = content[:description].presence || content[:excerpt].presence || facts.join(" · ").presence || item["title"]
      item["metadata"]["source_label"] = [ "Current story", content[:sourceName] || content[:source_name] ].compact_blank.join(" · ")
      item["metadata"]["provenance"] = facts.join(" · ") if facts.any?
      reason = content[:interestReason] || content[:interest_reason] || "From current stories"
      item["metadata"]["why_it_matters"] = reason
      item["metadata"]["variant"] = "story"
      @payload["understanding"] = current_story_understanding(reason)
      @payload["current_intention"] = "Bring one relevant current discovery into view."
    end

    def ground_activity(item, content)
      item["summary"] = content[:description].presence || "Recent work in #{content[:projectName] || item["title"]}."
      item["metadata"]["source_label"] = "Last worked on"
      item["metadata"]["variant"] = "activity"
      item["metadata"]["provenance"] = formatted_date(content[:updatedAt] || content[:updated_at])
    end

    def ground_horoscope(item, content)
      item["summary"] = content[:description].presence || item["summary"]
      item["metadata"]["source_label"] = "Today"
      item["metadata"]["variant"] = "horoscope"
      item["metadata"]["provenance"] = formatted_date(content[:date])
    end

    def ground_forecast(item, content)
      item["summary"] = content[:description].presence || item["summary"]
      item["metadata"]["source_label"] = [ "Weather", content[:locationLabel] || content[:location_label] ].compact_blank.join(" · ")
      item["metadata"]["variant"] = "weather"
      item["metadata"]["provenance"] = formatted_date(content[:observedAt] || content[:observed_at])
      item["metadata"]["why_it_matters"] = "Local conditions can shape what is worth doing now."
    end

    def ground_archive_item(item, content)
      excerpt = content[:excerpt].presence || content[:summary].presence
      item["summary"] = readable_markdown(excerpt) if excerpt.present?
      item["metadata"]["source_label"] = "From your archive"
      item["metadata"]["variant"] = "archive"
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
