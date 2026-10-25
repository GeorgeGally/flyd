require "pg"

module IntelligenceState
  class PosttractionPresentationRecorder
    POSTTRACTION_DB = PosttractionProvider::POSTTRACTION_DB
    SOURCE_TABLES = {
      "quote" => "quotes",
      "idea" => "ideas",
      "history" => "history_events"
    }.freeze

    def self.call(surface:)
      new(surface).call
    end

    def initialize(surface)
      @surface = surface
    end

    def call
      records = presented_records
      return 0 if records.empty?

      conn = PG.connect(dbname: POSTTRACTION_DB)
      now = Time.current.iso8601
      records.each do |table, id|
        conn.exec_params(
          "UPDATE #{conn.escape_identifier(table)} SET status = 1, last_shown_at = $1, updated_at = $1 WHERE id = $2",
          [ now, id ]
        )
      end
      records.length
    ensure
      conn&.close
    end

    private

    def presented_records
      @surface.items.flat_map(&:source_refs).filter_map do |reference|
        match = reference.to_h.deep_stringify_keys.fetch("id", "").match(/\Aposttraction:(quote|idea|history):([A-Za-z0-9_-]+)\z/)
        [ SOURCE_TABLES.fetch(match[1]), match[2] ] if match
      end.uniq
    end
  end
end
