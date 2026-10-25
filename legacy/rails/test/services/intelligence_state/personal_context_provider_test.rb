require "test_helper"

class IntelligenceState::PersonalContextProviderTest < ActiveSupport::TestCase
  test "persists local activity and horoscope observations" do
    activity = evidence("activity:flyd", "activity", "Continue Flyd")
    horoscope = evidence("horoscope:aries:2026-07-14", "horoscope", "Aries")

    record, changed = IntelligenceState::PersonalContextProvider.new.persist!(activities: [ activity ], horoscopes: [ horoscope ])
    snapshot = IntelligenceState::PersonalContextProvider.new.snapshot

    assert changed
    assert_equal record.id, snapshot.snapshot_id
    assert_equal "Continue Flyd", snapshot.data[:activities].first.dig("content", "title")
    assert_equal "Aries", snapshot.data[:horoscopes].first.dig("content", "title")
  end

  private

  def evidence(id, type, title)
    {
      "id" => id,
      "type" => type,
      "source" => "test",
      "epistemicStatus" => "observation",
      "confidence" => 0.9,
      "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => { "title" => title, "description" => "Grounded personal context for the current stage." }
    }
  end
end
