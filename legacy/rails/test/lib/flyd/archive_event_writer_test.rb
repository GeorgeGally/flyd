require "test_helper"
require "tmpdir"

class Flyd::ArchiveEventWriterTest < ActiveSupport::TestCase
  test "writes a CLI-compatible capture atomically and idempotently" do
    Dir.mktmpdir do |directory|
      writer = Flyd::ArchiveEventWriter.new(raw_dir: directory)
      attributes = {
        event_key: "intent:42:accepted",
        body: "Fix the Flyd surface",
        event_type: "intent",
        outcome: "accepted",
        project: "Flyd",
        record_type: "Intent",
        record_id: 42,
        timestamp: Time.zone.parse("2026-07-17 09:15:00")
      }

      first = writer.write!(**attributes)
      second = writer.write!(**attributes)
      parsed = Flyd::FrontmatterParser.parse(File.read(first))

      assert_equal first, second
      assert_equal 1, Dir.glob(File.join(directory, "*.md")).length
      assert_equal "rails", parsed.metadata["source"]
      assert_equal "intent", parsed.metadata["event_type"]
      assert_equal "accepted", parsed.metadata["outcome"]
      assert_equal "Fix the Flyd surface", parsed.body
    end
  end

  test "refuses empty archive events" do
    Dir.mktmpdir do |directory|
      assert_raises(ArgumentError) do
        Flyd::ArchiveEventWriter.new(raw_dir: directory).write!(event_key: "empty", body: " ")
      end
    end
  end
end
