require "test_helper"

class IntelligenceSnapshotTest < ActiveSupport::TestCase
  test "content digest is stable across hash key order" do
    first = {
      "goals" => [{ "id" => "ship", "title" => "Ship Flyd" }],
      "source" => "flyd-cli"
    }
    second = {
      "source" => "flyd-cli",
      "goals" => [{ "title" => "Ship Flyd", "id" => "ship" }]
    }

    assert_equal IntelligenceSnapshot.digest_for(first), IntelligenceSnapshot.digest_for(second)
  end

  test "latest usable snapshot ignores a newer failure record" do
    usable = IntelligenceSnapshot.create!(
      provider: "flyd-cli",
      schema_version: "1.0",
      status: "fresh",
      generated_at: Time.current,
      received_at: 1.minute.ago,
      fresh_until: 10.minutes.from_now,
      state_digest: "usable",
      payload: { "goals" => [] }
    )
    IntelligenceSnapshot.create!(
      provider: "flyd-cli",
      schema_version: "1.0",
      status: "unavailable",
      received_at: Time.current,
      state_digest: "failure",
      provider_errors: [ "offline" ]
    )

    assert_equal usable, IntelligenceSnapshot.latest_for("flyd-cli")
    assert_equal "unavailable", IntelligenceSnapshot.latest_record_for("flyd-cli").status
  end
end
