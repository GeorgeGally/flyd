require "test_helper"

class IntelligenceState::PosttractionPresentationRecorderTest < ActiveSupport::TestCase
  Item = Struct.new(:source_refs)
  PresentedSurface = Struct.new(:items)

  class Connection
    attr_reader :updates
    attr_accessor :closed

    def initialize
      @updates = []
      @closed = false
    end

    def escape_identifier(value) = %Q{"#{value}"}
    def exec_params(statement, values) = updates << [ statement, values ]
    def close = self.closed = true
  end

  test "marks only Posttraction records selected for the activated surface" do
    surface = PresentedSurface.new([ Item.new([
      { "type" => "quote", "id" => "posttraction:quote:17" },
      { "type" => "discovery", "id" => "discovery:other:4" }
    ]) ])
    connection = Connection.new

    PG.stub(:connect, connection) do
      assert_equal 1, IntelligenceState::PosttractionPresentationRecorder.call(surface: surface)
    end

    assert_match(/UPDATE "quotes"/, connection.updates.first.first)
    assert_equal "17", connection.updates.first.last.last
    assert connection.closed
  end
end
