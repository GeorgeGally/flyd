require "test_helper"

class IntelligenceState::PosttractionProviderTest < ActiveSupport::TestCase
  Result = Struct.new(:rows) do
    def ntuples = rows.length
    def first = rows.first
    def map(&block) = rows.map(&block)
    def values = rows
    def zero? = rows.empty?
    def any? = rows.any?
  end

  class Connection
    attr_reader :statements
    attr_accessor :closed

    def initialize(rows = [])
      @rows = rows
      @statements = []
      @closed = false
    end

    def escape_identifier(value) = %Q{"#{value}"}

    def exec(statement)
      @statements << statement
      Result.new(@rows)
    end

    def exec_params(statement, _parameters)
      @statements << statement
      if statement.include?("information_schema.columns")
        Result.new([ { "exists" => "1" } ])
      elsif statement.include?("date_key")
        Result.new(@rows)
      else
        Result.new(@rows)
      end
    end

    def close = self.closed = true
  end

  test "retrieval returns quotes and ideas as content hashes" do
    connection = Connection.new([ { "id" => "7", "content" => "A useful fragment", "author" => "Someone" } ])
    provider = IntelligenceState::PosttractionProvider.new

    items = provider.send(:pick_rotating, connection, "quotes", "content")
    assert_equal 1, items.size
    assert_equal "7", items.first[:id]
    assert_equal "A useful fragment", items.first[:content]
    assert_equal "Someone", items.first[:author]
  end

  test "retrieval returns history events with headline and angle" do
    connection = Connection.new([ {
      "id" => "8", "headline" => "A historical event", "interesting_angle" => "Unexpected context",
      "year" => "1984", "source_url" => "https://example.test/history"
    } ])
    provider = IntelligenceState::PosttractionProvider.new

    items = provider.send(:pick_on_this_day, connection)

    assert_equal 1, items.size
    assert_equal "8", items.first[:id]
    assert_equal "A historical event", items.first[:headline]
    assert_equal "Unexpected context", items.first[:interesting_angle]
  end

  test "connection closes when retrieval raises" do
    connection = Connection.new
    provider = IntelligenceState::PosttractionProvider.new

    PG.stub(:connect, connection) do
      assert_raises(RuntimeError) do
        provider.send(:with_posttraction) { raise "broken read" }
      end
    end

    assert connection.closed
  end

  test "evidence preserves rotation ids and includes ideas" do
    data = IntelligenceState::PosttractionProvider.new.send(:evidence_from, {
      quotes: [ { id: "7", content: "Quote" } ],
      ideas: [ { id: "9", content: "Idea" } ],
      history_events: [ { id: "8", headline: "History", interesting_angle: "Angle" } ]
    })

    assert_equal "posttraction:quote:7", data.dig("quotes", 0, "id")
    assert_equal "posttraction:idea:9", data.dig("ideas", 0, "id")
    assert_equal "posttraction:history:8", data.dig("discoveries", 0, "id")
  end

  test "rss articles preserve the source_url used by Posttraction" do
    connection = Connection.new([ {
      "id" => "11", "title" => "A useful article", "description" => "Worth reading",
      "source_url" => "https://example.test/article"
    } ])

    article = IntelligenceState::PosttractionProvider.new.send(:pick_recent_articles, connection, 1).first

    assert_equal "11", article[:id]
    assert_equal "https://example.test/article", article[:url]
  end

  test "connection failure produces an unhealthy snapshot" do
    PG.stub(:connect, ->(**) { raise PG::ConnectionBad, "database offline" }) do
      snapshot = IntelligenceState::PosttractionProvider.new.snapshot

      assert_not snapshot.fresh
      assert_includes snapshot.errors.first, "database offline"
      assert_nil snapshot.snapshot_id
    end
  end
end
