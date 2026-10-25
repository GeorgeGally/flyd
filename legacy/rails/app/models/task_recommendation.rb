class TaskRecommendation < ApplicationRecord
  DISPOSITIONS = %w[offered accepted adapted rejected].freeze

  belongs_to :agent_task
  belongs_to :task_session, optional: true
  belongs_to :surface_item, optional: true

  validates :release_key, :action, :action_digest, presence: true
  validates :task_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :disposition, inclusion: { in: DISPOSITIONS }
  validate :has_evidence_source

  private

  def has_evidence_source
    errors.add(:base, "Recommendation requires a task session or surface item") unless task_session || surface_item
  end
end
