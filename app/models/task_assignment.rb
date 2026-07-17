class TaskAssignment < ApplicationRecord
  STATUSES = %w[pending running verified blocked integrated failed cancelled].freeze

  belongs_to :agent_task

  has_many :worker_sessions, dependent: :restrict_with_error

  before_validation :assign_assignment_key, on: :create

  validates :assignment_key, :title, :instructions, presence: true
  validates :assignment_key, uniqueness: true
  validates :status, inclusion: { in: STATUSES }
  validates :revision, numericality: { only_integer: true, greater_than: 0 }
  validate :dependency_keys_are_valid

  def readonly?
    persisted?
  end

  private

  def assign_assignment_key
    self.assignment_key ||= SecureRandom.uuid
  end

  def dependency_keys_are_valid
    keys = dependency_keys
    valid = keys.is_a?(Array) &&
      keys.all? { |key| key.is_a?(String) && key.present? } &&
      keys.uniq.length == keys.length &&
      keys.exclude?(assignment_key)
    errors.add(:dependency_keys, "must contain distinct assignment keys other than itself") unless valid
  end
end
