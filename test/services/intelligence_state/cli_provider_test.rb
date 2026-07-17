require "test_helper"

class IntelligenceState::CliProviderTest < ActiveSupport::TestCase
  test "persists and reads the versioned CLI intelligence state contract" do
    provider = IntelligenceState::CliProvider.new
    record, changed = provider.persist!(payload(generated_at: Time.current))
    snapshot = provider.snapshot

    assert changed
    assert record.persisted?
    assert snapshot.fresh
    assert_empty snapshot.errors
    assert_equal record.id, snapshot.snapshot_id
    assert_equal record.state_digest, snapshot.state_digest
    assert_equal "ship-flyd", snapshot.data[:goals].first.dig("content", "slug")
    assert_equal "generative art", snapshot.data[:profile].first.dig("content", "interests", 0, "topic")
  end

  test "does not create a duplicate snapshot for unchanged state" do
    provider = IntelligenceState::CliProvider.new
    state = payload(generated_at: Time.current)
    refreshed_at = 1.minute.from_now

    first, first_changed = provider.persist!(state)
    second, second_changed = provider.persist!(state.merge("generatedAt" => refreshed_at.iso8601))

    assert first_changed
    assert_not second_changed
    assert_equal first, second
    assert_equal 1, IntelligenceSnapshot.where(provider: "flyd-cli").count
    assert_equal refreshed_at.to_i, second.generated_at.to_i
  end

  test "ignores volatile evidence generation times when detecting semantic changes" do
    provider = IntelligenceState::CliProvider.new
    state = payload(generated_at: Time.current)
    first, = provider.persist!(state)
    refreshed = state.deep_dup
    refreshed["generatedAt"] = 2.minutes.from_now.iso8601
    refreshed["brainHealth"].first["generatedAt"] = 2.minutes.from_now.iso8601

    second, changed = provider.persist!(refreshed)

    assert_not changed
    assert_equal first.id, second.id
  end

  test "returns unavailable state when no snapshot exists" do
    snapshot = IntelligenceState::CliProvider.new.snapshot

    assert_not snapshot.fresh
    assert_nil snapshot.snapshot_id
    assert_nil snapshot.state_digest
    assert_empty snapshot.data
    assert_match(/No persisted/, snapshot.errors.first)
  end

  test "marks old provider state stale" do
    provider = IntelligenceState::CliProvider.new
    provider.persist!(payload(generated_at: 1.hour.ago))

    assert_not provider.snapshot.fresh
  end

  test "rejects nonnumeric evidence confidence" do
    state = payload(generated_at: Time.current)
    state["goals"].first["confidence"] = "not-a-number"

    assert_raises(ArgumentError) do
      IntelligenceState::CliProvider.new.persist!(state)
    end
  end

  test "retains usable evidence while exposing a later refresh failure" do
    provider = IntelligenceState::CliProvider.new
    usable, = provider.persist!(payload(generated_at: Time.current))
    provider.record_failure!(RuntimeError.new("export unavailable"))

    snapshot = provider.snapshot

    assert snapshot.fresh
    assert_equal usable.id, snapshot.snapshot_id
    assert_equal usable.state_digest, snapshot.state_digest
    assert_equal "ship-flyd", snapshot.data[:goals].first.dig("content", "slug")
    assert_equal [ "export unavailable" ], snapshot.errors
  end

  private

  def payload(generated_at:)
    {
      "version" => "1.0",
      "generatedAt" => generated_at.iso8601,
      "source" => "flyd-cli",
      "goals" => [ evidence("goal", "goal:ship-flyd", { "slug" => "ship-flyd", "title" => "Ship Flyd" }) ],
      "tensions" => [],
      "signals" => [],
      "curiosity" => [],
      "nudges" => [],
      "reports" => [],
      "recentEvents" => [],
      "brainHealth" => [ evidence("brain_health", "brain_health:1", { "usableCaptures" => 10 }) ],
      "profile" => [ evidence("profile", "profile:1", { "interests" => [{ "topic" => "generative art" }] }) ],
      "knowledge" => [],
      "review" => [],
      "suggestions" => [],
      "capabilities" => []
    }
  end

  def evidence(type, id, content)
    {
      "id" => id,
      "type" => type,
      "source" => "test",
      "epistemicStatus" => "user_confirmed",
      "confidence" => 0.9,
      "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => content
    }
  end
end
