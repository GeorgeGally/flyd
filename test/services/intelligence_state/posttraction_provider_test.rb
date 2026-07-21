require "test_helper"

class IntelligenceState::PosttractionProviderTest < ActiveSupport::TestCase
  Result = Struct.new(:rows) do
    def ntuples = rows.length
    def first = rows.first
    def map(&block) = rows.map(&block)
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
      else
        Result.new(@rows)
      end
    end

    def close = self.closed = true
  end

  test "retrieval does not mark quotes or ideas as shown" do
    connection = Connection.new([ { "id" => "7", "content" => "A useful fragment" } ])
    provider = IntelligenceState::PosttractionProvider.new

    item = provider.send(:pick_rotating, connection, "quotes", "content")

    assert_equal "7", item[:id]
    assert_not connection.statements.any? { |statement| statement.match?(/\AUPDATE/i) }
  end

  test "retrieval does not mark history as shown" do
    connection = Connection.new([ {
      "id" => "8", "headline" => "A historical event", "interesting_angle" => "Unexpected context",
      "year" => "1984", "source_url" => "https://example.test/history"
    } ])
    provider = IntelligenceState::PosttractionProvider.new

    items = provider.send(:pick_on_this_day, connection)

    assert_equal "8", items.first[:id]
    assert_not connection.statements.any? { |statement| statement.match?(/\AUPDATE/i) }
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

  test "connection failure produces an unhealthy snapshot instead of fresh empty evidence" do
    PG.stub(:connect, ->(**) { raise PG::ConnectionBad, "database offline" }) do
      snapshot = IntelligenceState::PosttractionProvider.new.snapshot

      assert_not snapshot.fresh
      assert_includes snapshot.errors.first, "database offline"
      assert_nil snapshot.snapshot_id
    end
  end
end
