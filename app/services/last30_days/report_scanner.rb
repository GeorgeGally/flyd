require "digest"
require "json"

module Last30Days
  class ReportScanner
    DEFAULT_LIMIT = 12

    def initialize(root:, limit: DEFAULT_LIMIT)
      @root = Pathname.new(root.to_s).expand_path
      @limit = limit
    end

    def fetch
      return [] unless @root.directory?

      paths.flat_map { |path| reports_from(path) }.first(@limit)
    end

    private

    def paths
      Dir.glob(@root.join("**", "*.json")).reject { |path| path.end_with?(".publish.json") }
        .sort_by { |path| -File.mtime(path).to_f }
    end

    def reports_from(path)
      payload = JSON.parse(File.read(path))
      reports_from_payload(payload, path)
    rescue JSON::ParserError, Errno::ENOENT, Errno::EACCES
      []
    end

    def reports_from_payload(payload, path)
      return comparison_reports(payload, path) if payload["comparison"] && payload["reports"].is_a?(Array)
      return [ discovery_report(payload, path) ].compact if payload["kind"] == "discovery"

      [ agent_report(payload, path) ].compact
    end

    def comparison_reports(payload, path)
      payload["reports"].filter_map do |entry|
        report = entry["report"].to_h
        report = report.merge("query" => entry["entity"]) if report["query"].blank? && entry["entity"].present?
        agent_report(report, path)
      end
    end

    def agent_report(payload, path)
      return unless payload["query"].present? && payload["generated_at"].present?

      cluster = Array(payload["clusters"]).first.to_h
      result = Array(payload["results"]).first.to_h
      title = "Last 30 days: #{payload.fetch("query")}"
      excerpt = cluster["summary"].presence || result["summary"].presence || cluster["title"].presence
      return if excerpt.blank?

      evidence(
        payload: payload,
        path: path,
        title: title,
        excerpt: excerpt,
        url: result["url"],
        sources: Array(cluster["sources"]).presence || Array(payload["source_status"]&.keys),
        topics: Array(cluster["title"]).compact_blank.map { |topic| topic.to_s.downcase },
        result_count: Array(payload["results"]).length,
        confidence: confidence_for(result)
      )
    end

    def discovery_report(payload, path)
      results = Array(payload["results"])
      return if results.empty?

      top = results.first.to_h
      domain = payload["domain"].presence || "current topics"
      evidence(
        payload: payload,
        path: path,
        title: "Last 30 days discovery: #{domain}",
        excerpt: top["why_spiking"].presence || top["topic"],
        url: Array(top["evidence_urls"]).first,
        sources: Array(top["sources"]),
        topics: results.first(5).filter_map { |result| result["topic"].presence },
        result_count: results.length,
        confidence: 0.84
      )
    end

    def evidence(payload:, path:, title:, excerpt:, url:, sources:, topics:, result_count:, confidence:)
      generated_at = Time.zone.parse(payload.fetch("generated_at").to_s)
      {
        "id" => "report:last30days:#{digest_for(payload, path)}",
        "type" => "report",
        "source" => "last30days",
        "epistemicStatus" => "observation",
        "confidence" => confidence,
        "generatedAt" => generated_at.iso8601,
        "evidenceRefs" => [],
        "content" => {
          "title" => title,
          "excerpt" => excerpt,
          "description" => excerpt,
          "url" => url,
          "path" => path.to_s,
          "query" => payload["query"] || payload["domain"],
          "windowDays" => payload["window_days"],
          "sourceStatus" => payload["source_status"],
          "sources" => sources,
          "topics" => topics,
          "resultCount" => result_count
        }.compact
      }
    rescue ArgumentError, KeyError
      nil
    end

    def digest_for(payload, path)
      Digest::SHA256.hexdigest([
        payload["schema_version"],
        payload["kind"],
        payload["query"],
        payload["domain"],
        payload["generated_at"],
        File.basename(path)
      ].compact.join(":")).first(16)
    end

    def confidence_for(result)
      score = Float(result["relevance_score"], exception: false)
      return 0.82 unless score

      [[ score, 0.7 ].max, 0.95].min
    end
  end
end
