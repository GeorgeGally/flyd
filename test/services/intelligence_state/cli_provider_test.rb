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
    assert_equal "ship-flyd", snapshot.data[:goals].first["slug"]
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

  test "returns unavailable state when no snapshot exists" do
    snapshot = IntelligenceState::CliProvider.new.snapshot

    assert_not snapshot.fresh
    assert_empty snapshot.data
    assert_match(/No persisted/, snapshot.errors.first)
  end

  test "marks old provider state stale" do
    provider = IntelligenceState::CliProvider.new
    provider.persist!(payload(generated_at: 1.hour.ago))

    snapshot = provider.snapshot

    assert_not snapshot.fresh
  end

  test "retains usable evidence while exposing a later refresh failure" do
    provider = IntelligenceState::CliProvider.new
    provider.persist!(payload(generated_at: Time.current))
    provider.record_failure!(RuntimeError.new("export unavailable"))

    snapshot = provider.snapshot

    assert snapshot.fresh
    assert_equal "ship-flyd", snapshot.data[:goals].first["slug"]
    assert_equal ["export unavailable"], snapshot.errors
  end

  private

  def payload(generated_at:)
    {
      "version" => "1.0",
      "generatedAt" => generated_at.iso8601,
      "source" => "flyd-cli",
      "goals" => [{ "slug" => "ship-flyd", "title" => "Ship Flyd" }],
      "tensions" => [],
      "signals" => [],
      "curiosity" => [],
      "nudges" => [],
      "reports" => [],
      "recentEvents" => []
    }
  end
end
