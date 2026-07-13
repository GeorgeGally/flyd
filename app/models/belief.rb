class Belief < ApplicationRecord
  include Decayable

  belongs_to :project, optional: true

  before_validation :set_default_status

  validates :statement, presence: true
  validates :confidence, numericality: { in: 0.0..1.0 }
  validates :status, inclusion: { in: %w[active challenged superseded] }

  scope :active, -> { where(status: "active") }
  scope :cross_project, -> { where(project: nil) }

  def decay_type
    project ? :project_decision : :cross_project_belief
  end

  def depends_on_any?(decision_ids)
    (Array(source_decision_ids).map(&:to_i) & Array(decision_ids).map(&:to_i)).any?
  end

  def remove_sources!(decision_ids)
    remaining = Array(source_decision_ids).map(&:to_i) - Array(decision_ids).map(&:to_i)
    update!(source_decision_ids: remaining, status: remaining.empty? ? "superseded" : "challenged")
  end

  def challenge!
    update!(status: "challenged")
  end

  def supersede!
    update!(status: "superseded")
  end

  private

  def set_default_status
    self.status ||= "active"
  end
end
