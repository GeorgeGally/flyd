require "test_helper"

class IntelligenceState::RegistryTest < ActiveSupport::TestCase
  FakeSnapshot = Data.define(:source, :snapshot_id, :state_digest, :generated_at, :fresh, :data, :errors)

  FakeProvider = Struct.new(:source) do
    def snapshot
      IntelligenceState::RegistryTest::FakeSnapshot.new(source:, snapshot_id: nil, state_digest: nil, generated_at: nil, fresh: true, data: {}, errors: [])
    end
  end

  FakeQueryProvider = Struct.new(:queries) do
    def snapshot(query:)
      queries << query
      IntelligenceState::RegistryTest::FakeSnapshot.new(source: "flyd-cli-query", snapshot_id: 9, state_digest: "query", generated_at: Time.current, fresh: true, data: {}, errors: [])
    end
  end

  test "adds targeted CLI evidence when composition supplies a query" do
    query_provider = FakeQueryProvider.new([])
    registry = IntelligenceState::Registry.new(providers: [ FakeProvider.new("base") ], query_provider: query_provider)

    result = registry.snapshot(query: "What was I working on?")

    assert_equal [ "What was I working on?" ], query_provider.queries
    assert_equal [ "base", "flyd-cli-query" ], result[:providers].map { |provider| provider[:source] }
  end

  test "does not query the archive without a meaningful question" do
    query_provider = FakeQueryProvider.new([])
    registry = IntelligenceState::Registry.new(providers: [ FakeProvider.new("base") ], query_provider: query_provider)

    result = registry.snapshot

    assert_empty query_provider.queries
    assert_equal [ "base" ], result[:providers].map { |provider| provider[:source] }
  end

  test "includes last30days reports in the default provider set" do
    provider_sources = IntelligenceState::Registry.new.snapshot[:providers].map { |provider| provider[:source] }

    assert_includes provider_sources, "last30days"
  end

  test "includes weather forecasts in the default provider set" do
    provider_sources = IntelligenceState::Registry.new.snapshot[:providers].map { |provider| provider[:source] }

    assert_includes provider_sources, "weather"
  end
end
