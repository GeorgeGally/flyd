class Belief < ApplicationRecord
  include Decayable

  belongs_to :project, optional: true

  validates :statement, presence: true
  validates :confidence, numericality: { in: 0.0..1.0 }
  validates :status, inclusion: { in: %w[active challenged superseded] }

  scope :active, -> { where(status: "active") }
  scope :cross_project, -> { where(project: nil) }

  def decay_type
    project ? :project_decision : :cross_project_belief
  end

  def challenge!
    update!(status: "challenged")
  end

  def supersede!
    update!(status: "superseded")
  end
end
