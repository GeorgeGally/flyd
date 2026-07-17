class WorkerCommand < ApplicationRecord
  KINDS = %w[stop retry redirect replace].freeze
  STATUSES = %w[queued dispatched completed failed cancelled].freeze

  belongs_to :agent_task
  belongs_to :worker_session

  before_validation :assign_command_key, on: :create

  validates :command_key, :idempotency_key, presence: true
  validates :command_key, :idempotency_key, uniqueness: true
  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }
  validate :worker_belongs_to_task

  def readonly?
    persisted?
  end

  private

  def assign_command_key
    self.command_key ||= SecureRandom.uuid
  end

  def worker_belongs_to_task
    return if worker_session.nil? || worker_session.agent_task_id == agent_task_id

    errors.add(:worker_session, "must belong to the same task")
  end
end
