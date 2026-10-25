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
        ideas = pick_rotating(conn, "ideas", "content", 3)
        {
          quotes: pick_rotating(conn, "quotes", "content", 3),
          facts: pick_facts(conn, 3),
          rss_articles: pick_recent_articles(conn, 5),
          history_events: pick_on_this_day(conn),
          ideas: ideas.any? ? ideas : []
        }
      end

      data = evidence_from(items)
      payload = payload_for(data, generated_at)
      digest = IntelligenceSnapshot.semantic_digest_for(payload)
      record = IntelligenceSnapshot.find_or_initialize_by(provider: PROVIDER, state_digest: digest)
      record.update!(
        schema_version: SCHEMA_VERSION, status: "fresh",
        generated_at: generated_at, received_at: generated_at,
        fresh_until: generated_at + FRESH_FOR,
        payload: payload, provider_errors: []
      )

      Snapshot.new(
        source: PROVIDER, snapshot_id: record.id, state_digest: digest,
        generated_at: generated_at, fresh: true,
        data: data.deep_symbolize_keys, errors: []
      )
    rescue => error
      Rails.logger.warn("PosttractionProvider failed: #{error.message}")
      Snapshot.new(source: PROVIDER, snapshot_id: nil, state_digest: nil,
                   generated_at: nil, fresh: false,
                   data: empty_data.deep_symbolize_keys, errors: [ error.message ])
    end

    private

    def with_posttraction
      conn = PG.connect(dbname: POSTTRACTION_DB)
      yield conn
    ensure
      conn&.close
    end

    def pick_rotating(conn, table, content_column, limit = 1)
      cols = quote_columns_for(conn, table)
      select = cols.join(", ")
      result = conn.exec("SELECT id, #{select} FROM \"#{table}\" WHERE status IN (0, 1) ORDER BY status ASC, last_shown_at ASC NULLS FIRST LIMIT #{limit.to_i}")
      return [] if result.ntuples.zero?

      result.map do |row|
        content = row[content_column] || row["content"]
        next if content.to_s.strip.empty?
        { id: row.fetch("id"), content: content, author: row["author"], source: row["source"], topic_id: row["topic_id"] }.compact
      end.compact
    end

    def pick_facts(conn, limit = 3)
      cols = ["content", "source_url", "topic_id"].select { |c| column_exists?(conn, "facts", c) }
      select = cols.join(", ")
      result = conn.exec("SELECT id, #{select} FROM facts ORDER BY RANDOM() LIMIT #{limit.to_i}")
      result.map do |row|
        content = row["content"].to_s.strip
        next if content.empty?
        { id: row.fetch("id"), content: content, source_url: row["source_url"] }.compact
      end.compact
    end

    def pick_recent_articles(conn, limit = 5)
      cols = ["title", "description", "url", "source_url", "image_url", "site_name", "published_at"]
        .select { |c| column_exists?(conn, "rss_articles", c) }
      select = cols.join(", ")
      result = conn.exec("SELECT id, #{select} FROM rss_articles ORDER BY published_at DESC NULLS LAST LIMIT #{limit.to_i}")
      result.map do |row|
        title = row["title"].to_s.strip
        next if title.empty?
        {
          id: row.fetch("id"),
          title: title,
          description: (row["description"] || row["url"]).to_s.strip,
          url: row["url"].presence || row["source_url"],
          image_url: row["image_url"],
          site_name: row["site_name"],
          published_at: row["published_at"]
        }.compact
      end.compact
    end

    def pick_on_this_day(conn)
      today = Time.zone.today
      date_key = today.strftime("%m-%d")
      result = conn.exec_params(
        "SELECT id, headline, interesting_angle, source_url, year FROM history_events WHERE status = 0 AND date_key = $1 ORDER BY last_shown_at ASC NULLS FIRST LIMIT 3",
        [ date_key ]
      )
      if result.ntuples.zero?
        result = conn.exec_params(
          "SELECT id, headline, interesting_angle, source_url, year FROM history_events WHERE status = 1 AND date_key = $1 ORDER BY last_shown_at ASC NULLS FIRST LIMIT 3",
          [ date_key ]
        )
      end
      result.map do |row|
        { id: row.fetch("id"), headline: row["headline"], interesting_angle: row["interesting_angle"],
          year: row["year"], source_url: row["source_url"] }
      end
    end

    def column_exists?(conn, table, column)
      result = conn.exec_params(
        "SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2",
        [ table, column ]
      )
      result.ntuples.positive?
    end

    def quote_columns_for(conn, table)
      ["content", "author", "source", "topic_id"].select { |c| column_exists?(conn, table, c) }
    end

    def payload_for(data, generated_at)
      { "version" => SCHEMA_VERSION, "source" => PROVIDER,
        "generatedAt" => generated_at.iso8601, "data" => data }
    end

    def evidence_from(items)
      ev = {}

      Array(items[:quotes]).each do |q|
        (ev["quotes"] ||= []) << discovery_evidence(
          id: "posttraction:quote:#{q.fetch(:id)}", type: "quote",
          title: q[:author] ? "\"#{q[:content].to_s.truncate(100)}\"" : q[:content].to_s.truncate(140),
          excerpt: q[:content].to_s.truncate(280),
          source_label: q[:author] ? "— #{q[:author]}" : "From your quotes"
        )
      end

      Array(items[:facts]).each do |f|
        (ev["facts"] ||= []) << discovery_evidence(
          id: "posttraction:fact:#{f.fetch(:id)}", type: "fact",
          title: f[:content].to_s.truncate(120),
          excerpt: f[:content].to_s.truncate(320),
          source_label: "Something you might not know",
          url: f[:source_url]
        )
      end

      Array(items[:rss_articles]).each do |a|
        (ev["discoveries"] ||= []) << discovery_evidence(
          id: "posttraction:rss:#{a.fetch(:id)}", type: "discovery",
          title: a[:title].to_s.truncate(120),
          excerpt: a[:description].to_s.truncate(320),
          description: a[:description].to_s.truncate(500),
          source_label: a[:site_name] || "News",
          url: a[:url],
          image_url: a[:image_url]
        )
      end

      Array(items[:history_events]).each do |event|
        title = event[:year] ? "On this day (#{event[:year]})" : "On this day"
        title = "#{title}: #{event[:headline].to_s.truncate(100)}"
        (ev["discoveries"] ||= []) << discovery_evidence(
          id: "posttraction:history:#{event.fetch(:id)}", type: "discovery",
          title: title, excerpt: event[:interesting_angle].to_s.truncate(320),
          description: event[:interesting_angle].to_s.truncate(500),
          source_label: "On this day in history", url: event[:source_url]
        )
      end

      Array(items[:ideas]).each do |idea|
        (ev["ideas"] ||= []) << discovery_evidence(
          id: "posttraction:idea:#{idea.fetch(:id)}", type: "idea",
          title: idea[:content].to_s.truncate(120),
          excerpt: idea[:content].to_s.truncate(280),
          source_label: "An idea worth exploring"
        )
      end

      ev
    end

    def discovery_evidence(id:, type:, title:, excerpt:, source_label:, url: nil, description: nil, image_url: nil)
      content = { title: title, excerpt: excerpt, source_label: source_label }.compact
      content[:url] = url if url.present?
      content[:description] = description if description.present?
      content[:image_url] = image_url if image_url.present?
      {
        "id" => id, "type" => type, "source" => PROVIDER,
        "epistemicStatus" => "observation", "confidence" => 1.0,
        "generatedAt" => Time.current.iso8601, "evidenceRefs" => [],
        "content" => content
      }
    end

    def empty_data
      { "quotes" => [], "facts" => [], "discoveries" => [], "ideas" => [] }
    end
  end
end
