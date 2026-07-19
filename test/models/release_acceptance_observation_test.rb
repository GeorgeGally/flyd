require "test_helper"

class ReleaseAcceptanceObservationTest < ActiveSupport::TestCase
  test "records a bounded acceptance result with idempotent provenance" do
    observation = ReleaseAcceptanceObservation.create!(
      kind: "memory_safety",
      passed: true,
      evidence: { "note" => "Reviewed the sampled task evidence" },
      idempotency_key: SecureRandom.uuid,
      observed_at: Time.current
    )

    assert observation.persisted?
    assert_raises(ActiveRecord::RecordInvalid) do
      observation.dup.tap { |copy| copy.idempotency_key = observation.idempotency_key }.save!
    end
  end

  test "rejects unknown evidence classes" do
    observation = ReleaseAcceptanceObservation.new(
      kind: "looks_good",
      passed: true,
      idempotency_key: SecureRandom.uuid,
      observed_at: Time.current
    )

    assert_not observation.valid?
  end
end
