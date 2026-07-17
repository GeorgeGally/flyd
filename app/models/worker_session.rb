class WorkerSession < ApplicationRecord
  STATUSES = %w[queued starting running stopping completed failed interrupted cancelled stopped replaced].freeze

  belongs_to :agent_task
  belongs_to :task_grant
  belongs_to :task_assignment
  belongs_to :resumes_worker_session, class_name: "WorkerSession", optional: true

  has_many :runtime_events, dependent: :nullify
  has_many :worker_commands, dependent: :restrict_with_error

  before_validation :assign_worker_key, on: :create

  validates :worker_key, :adapter, :working_directory, presence: true
  validates :worker_key, uniqueness: true
  validates :status, inclusion: { in: STATUSES }
  validates :task_assignment_id, uniqueness: {
    conditions: -> { where(status: %w[queued starting running stopping]) },
    message: "already has a live worker"
  }, if: -> { status.in?(%w[queued starting running stopping]) }
  validate :grant_belongs_to_task
  validate :assignment_belongs_to_task
  validate :grant_authorizes_worker

  scope :live, -> { where(status: %w[queued starting running stopping]) }

  def readonly?
    persisted?
  end

  private

  def assign_worker_key
    self.worker_key ||= SecureRandom.uuid
  end

  def grant_belongs_to_task
    return if task_grant.nil? || task_grant.agent_task_id == agent_task_id

    errors.add(:task_grant, "must belong to the same task")
  end

  def assignment_belongs_to_task
    return if task_assignment.nil? || task_assignment.agent_task_id == agent_task_id

    errors.add(:task_assignment, "must belong to the same task")
  end

  def grant_authorizes_worker
    return if task_grant.nil?

    errors.add(:task_grant, "must be approved and unexpired") unless task_grant.approved? && !task_grant.expires_at&.past?
    approved_paths = task_grant.repository_roots + task_grant.worktree_paths
    errors.add(:working_directory, "must be inside the task grant") unless approved_paths.include?(working_directory)
    errors.add(:adapter, "must be allowed by the task grant") unless task_grant.worker_adapters.include?(adapter)
  end
end
