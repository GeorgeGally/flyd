require "pg"

module IntelligenceState
  class PosttractionProvider < Provider
    PROVIDER = "flyd-posttraction"
    SCHEMA_VERSION = "1.0"
    FRESH_FOR = 10.minutes
    POSTTRACTION_DB = "post_traction_rails_development"

    def snapshot
      generated_at = Time.current

      items = with_posttraction do |conn|
        quotes = pick_rotating(conn, "quotes", "content")
        ideas = pick_rotating(conn, "ideas", "content")
        {
          quotes: quotes ? [quotes] : [],
          history_events: pick_on_this_day(conn),
          ideas: ideas ? [ideas] : []
        }
      end

      data = evidence_from(items)
      payload = {
        "version" => SCHEMA_VERSION,
        "source" => PROVIDER,
        "generatedAt" => generated_at.iso8601,
        "data" => data
      }
      digest = IntelligenceSnapshot.semantic_digest_for(payload)
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      record.update!(
        schema_version: SCHEMA_VERSION,
        status: "fresh",
        generated_at: generated_at,
        received_at: generated_at,
        fresh_until: generated_at + FRESH_FOR,
        payload: payload,
        provider_errors: []
      )

      Snapshot.new(
        source: PROVIDER,
        snapshot_id: record.id,
        state_digest: digest,
        generated_at: generated_at,
        fresh: true,
        data: data.deep_symbolize_keys,
        errors: []
      )
    rescue => error
      Rails.logger.warn("PosttractionProvider failed: #{error.message}")
      Snapshot.new(
        source: PROVIDER,
        snapshot_id: nil,
        state_digest: nil,
        generated_at: nil,
        fresh: false,
        data: empty_data.deep_symbolize_keys,
        errors: [ error.message ]
      )
    end

    private

    def with_posttraction
      conn = PG.connect(dbname: POSTTRACTION_DB)
      yield conn
    ensure
      conn&.close
    end

    def pick_rotating(conn, table, content_column)
      pick = if table == "quotes" || table == "ideas"
               ["content", "author", "source", "topic_id"].select { |col| column_exists?(conn, table, col) }
             else
               ["content"]
             end
      select_cols = pick.join(", ")

      result = conn.exec(
        "SELECT id, #{select_cols} FROM #{conn.escape_identifier(table)} WHERE status = 0 ORDER BY last_shown_at ASC NULLS FIRST LIMIT 1"
      )

      if result.ntuples.zero?
        result = conn.exec(
          "SELECT id, #{select_cols} FROM #{conn.escape_identifier(table)} WHERE status = 1 ORDER BY last_shown_at ASC NULLS FIRST LIMIT 1"
        )
      end

      return nil if result.ntuples.zero?

      row = result.first
      content = row[content_column] || row["content"]
      return nil if content.blank?

      {
        id: row["id"],
        content: content,
        author: row["author"],
        source: row["source"],
        topic_id: row["topic_id"]
      }.compact
    end

    def pick_on_this_day(conn)
      today = Time.zone.today
      date_key = today.strftime("%m-%d")

      result = conn.exec_params(
        "SELECT id, headline, interesting_angle, source_url, year, date_key FROM history_events WHERE status = 0 AND date_key = $1 ORDER BY last_shown_at ASC NULLS FIRST LIMIT 3",
        [ date_key ]
      )

      if result.ntuples.zero?
        result = conn.exec_params(
          "SELECT id, headline, interesting_angle, source_url, year, date_key FROM history_events WHERE status = 1 AND date_key = $1 ORDER BY last_shown_at ASC NULLS FIRST LIMIT 3",
          [ date_key ]
        )
      end

      result.map do |row|
        { id: row["id"], headline: row["headline"], interesting_angle: row["interesting_angle"], year: row["year"], source_url: row["source_url"] }
      end
    end

    def column_exists?(conn, table, column)
      result = conn.exec_params(
        "SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2",
        [ table, column ]
      )
      result.ntuples.positive?
    end

    def evidence_from(items)
      evidence = {}

      Array(items[:quotes]).each do |quote|
        (evidence[:quotes] ||= []) << evidence_item(
          id: "posttraction:quote:#{quote.fetch(:id)}",
          type: "quote",
          generated_at: Time.current,
          content: {
            title: quote[:author].present? ? "#{quote[:author]}: #{quote[:content].to_s.truncate(120)}" : quote[:content].to_s.truncate(140),
            excerpt: quote[:content].to_s.truncate(280),
            author: quote[:author],
            source_label: "From your quotes"
          }
        )
      end

      Array(items[:history_events]).each do |event|
        title = event[:year] ? "On this day (#{event[:year]})" : "On this day"
        title = "#{title}: #{event[:headline].to_s.truncate(100)}"
        (evidence[:discoveries] ||= []) << evidence_item(
          id: "posttraction:history:#{event.fetch(:id)}",
          type: "discovery",
          generated_at: Time.current,
          content: {
            title: title,
            excerpt: event[:interesting_angle].to_s.truncate(320),
            description: event[:interesting_angle].to_s.truncate(500).presence || event[:headline].to_s.truncate(500),
            source_label: "On this day in history",
            url: event[:source_url]
          }
        )
      end

      Array(items[:ideas]).each do |idea|
        (evidence[:ideas] ||= []) << evidence_item(
          id: "posttraction:idea:#{idea.fetch(:id)}",
          type: "idea",
          generated_at: Time.current,
          content: {
            title: idea[:content].to_s.truncate(120),
            excerpt: idea[:content].to_s.truncate(280),
            source_label: "An idea worth exploring"
          }
        )
      end

      evidence
    end

    def evidence_item(id:, type:, generated_at:, content:, epistemic_status: "observation")
      {
        "id" => id,
        "type" => type,
        "source" => PROVIDER,
        "epistemicStatus" => epistemic_status,
        "confidence" => 1.0,
        "generatedAt" => generated_at.iso8601,
        "evidenceRefs" => [],
        "content" => content
      }
    end

    def empty_data
      { "quotes" => [], "discoveries" => [], "ideas" => [] }
    end
  end
end
