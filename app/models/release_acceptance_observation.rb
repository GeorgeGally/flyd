class ReleaseAcceptanceObservation < ApplicationRecord
  KINDS = %w[memory_safety recommendation_rationale automated_acceptance].freeze

  validates :kind, inclusion: { in: KINDS }
  validates :passed, inclusion: { in: [ true, false ] }
  validates :idempotency_key, presence: true, uniqueness: true
  validates :observed_at, presence: true
end
