require "test_helper"

class IntelligenceState::CliQueryProviderTest < ActiveSupport::TestCase
  FakeBridge = Struct.new(:payload, :error) do
    def retrieve(_query)
      raise error if error
      payload
    end
  end

  test "persists targeted memory matches as provider evidence" do
    provider = IntelligenceState::CliQueryProvider.new(bridge: FakeBridge.new(retrieval_payload, nil))

    snapshot = provider.snapshot(query: "What was I working on?")

    assert snapshot.fresh
    assert_equal "flyd-cli-query", snapshot.source
    assert_equal "memory_match:1", snapshot.data[:memory_matches].first.fetch("id")
    assert_equal "partial", snapshot.data[:memory_assessment].first.dig("content", "verdict")
    assert IntelligenceSnapshot.exists?(id: snapshot.snapshot_id, provider: "flyd-cli-query")
  end

  test "returns provider errors without breaking composition" do
    provider = IntelligenceState::CliQueryProvider.new(
      bridge: FakeBridge.new(nil, IntelligenceState::CliBridge::Error.new("archive unavailable"))
    )

    snapshot = provider.snapshot(query: "What was I working on?")

    assert_not snapshot.fresh
    assert_empty snapshot.data
    assert_match(/archive unavailable/, snapshot.errors.first)
  end

  test "preserves the last matching query snapshot when retrieval temporarily fails" do
    bridge = FakeBridge.new(retrieval_payload, nil)
    provider = IntelligenceState::CliQueryProvider.new(bridge: bridge)
    usable = provider.snapshot(query: "What was I working on?")
    bridge.error = IntelligenceState::CliBridge::Error.new("archive unavailable")

    fallback = provider.snapshot(query: "What was I working on?")

    assert_equal usable.snapshot_id, fallback.snapshot_id
    assert_equal "memory_match:1", fallback.data[:memory_matches].first.fetch("id")
    assert_equal [ "archive unavailable" ], fallback.errors
  end

  test "reuses a query snapshot when only retrieval timestamps change" do
    bridge = FakeBridge.new(retrieval_payload, nil)
    provider = IntelligenceState::CliQueryProvider.new(bridge: bridge)
    first = provider.snapshot(query: "What was I working on?")
    refreshed = bridge.payload.deep_dup
    refreshed["generatedAt"] = 2.minutes.from_now.iso8601
    refreshed["matches"].first["generatedAt"] = 2.minutes.from_now.iso8601
    bridge.payload = refreshed

    second = provider.snapshot(query: "What was I working on?")

    assert_equal first.snapshot_id, second.snapshot_id
  end

  private

  def retrieval_payload
    {
      "version" => "1.0",
      "source" => "flyd-cli",
      "query" => "What was I working on?",
      "generatedAt" => Time.current.iso8601,
      "sufficiency" => { "verdict" => "partial", "reason" => "One useful memory", "coverage" => 0.5 },
      "matches" => [{
        "id" => "memory_match:1",
        "type" => "memory_match",
        "source" => "cli.retrieval",
        "epistemicStatus" => "observation",
        "confidence" => 0.8,
        "generatedAt" => Time.current.iso8601,
        "evidenceRefs" => [],
        "content" => { "path" => "raw/work.md", "excerpt" => "The current Flyd work" }
      }]
    }
  end
end
