require "test_helper"
require "tmpdir"

class IntelligenceState::CliProviderTest < ActiveSupport::TestCase
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
    assert_match(/not found/, snapshot.errors.first)
  end
end
