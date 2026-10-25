class TaskCorrection < ApplicationRecord
  belongs_to :agent_task
  belongs_to :supersedes_task_correction, class_name: "TaskCorrection", optional: true
  has_many :superseding_task_corrections,
    class_name: "TaskCorrection",
    foreign_key: :supersedes_task_correction_id,
    dependent: :nullify,
    inverse_of: :supersedes_task_correction

  before_validation :assign_correction_key, on: :create

  validates :correction_key, :corrected_value, presence: true
  validates :correction_key, uniqueness: true
  validates :task_revision, uniqueness: { scope: :agent_task_id }
  validates :task_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :surface_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :authority, inclusion: { in: %w[user] }
  validate :superseded_correction_belongs_to_task

  def readonly?
    persisted?
  end

  private

  def assign_correction_key
    self.correction_key ||= SecureRandom.uuid
  end

  def superseded_correction_belongs_to_task
    return unless supersedes_task_correction && supersedes_task_correction.agent_task_id != agent_task_id

    errors.add(:supersedes_task_correction, "must belong to the same task")
  end
end
