class SurfacePreference < ApplicationRecord
  DIMENSIONS = %w[renderer kind intent context_type source_type].freeze
  DECAY = 0.9

  validates :dimension, inclusion: { in: DIMENSIONS }
  validates :value, presence: true
  validates :value, uniqueness: { scope: :dimension }

  scope :meaningful, -> { where("ABS(weight) >= ?", 0.15).order(Arel.sql("ABS(weight) DESC")) }

  def observe!(positive:)
    increment = positive ? 1.0 : -1.0
    update!(
      weight: (weight * DECAY) + increment,
      positive_count: positive_count + (positive ? 1 : 0),
      negative_count: negative_count + (positive ? 0 : 1),
      last_observed_at: Time.current
    )
  end
end
