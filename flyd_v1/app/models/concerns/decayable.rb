module Decayable
  extend ActiveSupport::Concern

  included do
    scope :decayed, -> { where(arel_table[:decay_score].lt(0.3)) }
  end

  HALF_LIVES = {
    project_decision: 90.days,
    cross_project_belief: 180.days,
    behaviour: 365.days
  }.freeze

  def half_life
    HALF_LIVES[decay_type] || 90.days
  end

  def compute_decay_score
    return 1.0 unless last_used_at
    elapsed = Time.current - last_used_at
    score = 2.0 ** (-elapsed / half_life)
    [ score, 0.0 ].max
  end

  def apply_decay!
    new_score = compute_decay_score
    update!(decay_score: new_score)
  end

  def reinforce!
    new_score = [ (compute_decay_score * 1.2 + 0.1), 1.0 ].min
    update!(decay_score: new_score, last_used_at: Time.current)
  end
end
