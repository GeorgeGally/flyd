require "test_helper"
require "tmpdir"

class IntelligenceState::CliProviderTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  test "loads the versioned CLI intelligence state contract" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "intelligence-state.json")
      File.write(path, {
        version: "1.0",
        generatedAt: Time.current.iso8601,
        source: "flyd-cli",
        goals: [{ slug: "ship-flyd", title: "Ship Flyd" }],
        tensions: [],
        signals: [],
        curiosity: [],
        nudges: [],
        reports: [],
        recentEvents: []
      }.to_json)

      snapshot = IntelligenceState::CliProvider.new(path: path, refresh: false).snapshot

      assert snapshot.fresh
      assert_empty snapshot.errors
      assert_equal "ship-flyd", snapshot.data[:goals].first["slug"]
    end
  end

  test "returns an explicit unavailable snapshot when state is missing" do
    snapshot = IntelligenceState::CliProvider.new(path: "/missing/intelligence-state.json", refresh: false).snapshot

    assert_not snapshot.fresh
    assert_empty snapshot.data
    assert_match(/unavailable/, snapshot.errors.first)
  end

  test "queues a refresh without blocking when state is stale" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "intelligence-state.json")
      File.write(path, {
        version: "1.0",
        generatedAt: 1.hour.ago.iso8601,
        source: "flyd-cli",
        goals: [], tensions: [], signals: [], curiosity: [], nudges: [], reports: [], recentEvents: []
      }.to_json)

      Rails.cache.stub(:write, true) do
        assert_enqueued_with(job: RefreshIntelligenceStateJob) do
          snapshot = IntelligenceState::CliProvider.new(path: path).snapshot
          assert_not snapshot.fresh
          assert_match(/refresh queued/, snapshot.errors.first)
        end
      end
    end
  end
end
