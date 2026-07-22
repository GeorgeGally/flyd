require "test_helper"
require "tmpdir"

class Last30Days::ReportScannerTest < ActiveSupport::TestCase
  test "converts saved agent JSON reports into Flyd report evidence" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "ai-agents-raw.json")
      File.write(path, agent_report.to_json)

      reports = Last30Days::ReportScanner.new(root: dir).fetch

      assert_equal 1, reports.length
      report = reports.first
      assert_equal "report", report.fetch("type")
      assert_equal "last30days", report.fetch("source")
      assert_equal "observation", report.fetch("epistemicStatus")
      assert_equal "Last 30 days: AI agents", report.dig("content", "title")
      assert_equal "Developers are comparing agent reliability across tool loops.", report.dig("content", "excerpt")
      assert_equal path, report.dig("content", "path")
      assert_equal [ "reddit", "hackernews" ], report.dig("content", "sources")
      assert_equal [ "agent reliability" ], report.dig("content", "topics")
    end
  end

  test "ignores malformed JSON files without failing the scan" do
    Dir.mktmpdir do |dir|
      File.write(File.join(dir, "bad.json"), "{")
      File.write(File.join(dir, "good.json"), agent_report.to_json)

      reports = Last30Days::ReportScanner.new(root: dir).fetch

      assert_equal [ "Last 30 days: AI agents" ], reports.map { |report| report.dig("content", "title") }
    end
  end

  private

  def agent_report
    {
      "schema_version" => "1.2",
      "query" => "AI agents",
      "generated_at" => Time.current.iso8601,
      "window_days" => 30,
      "source_status" => { "reddit" => "ok", "hackernews" => "ok" },
      "clusters" => [
        {
          "title" => "Agent reliability",
          "summary" => "Developers are comparing agent reliability across tool loops.",
          "sources" => [ "reddit", "hackernews" ],
          "engagement_total" => 420
        }
      ],
      "results" => [
        {
          "candidate_id" => "candidate:1",
          "title" => "Agent reliability",
          "source" => "reddit",
          "url" => "https://example.com/agents",
          "summary" => "Reliability is still the point of comparison.",
          "relevance_score" => 0.91,
          "cluster" => 0
        }
      ]
    }
  end
end
