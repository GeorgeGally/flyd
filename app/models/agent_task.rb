class AgentTask < ApplicationRecord
  ACTIVE_STATUSES = %w[awaiting_grant ready running blocked].freeze
  STATUSES = (ACTIVE_STATUSES + %w[completed failed cancelled]).freeze

  belongs_to :project

  has_many :task_grants, dependent: :destroy
  has_many :task_assignments, dependent: :destroy
  has_many :worker_sessions, dependent: :destroy
  has_many :worker_commands, dependent: :destroy
  has_many :task_sessions, dependent: :destroy
  has_many :runtime_events, dependent: :destroy
  has_many :task_artifacts, dependent: :destroy

  before_validation :assign_task_key, on: :create
  before_validation :set_started_at, on: :create

  validates :task_key, :intended_outcome, presence: true
  validates :task_key, uniqueness: true
  validates :status, inclusion: { in: STATUSES }
  validates :project_id, uniqueness: {
    conditions: -> { where(status: ACTIVE_STATUSES) },
    message: "already has unfinished work"
  }, if: :unfinished?

  scope :unfinished, -> { where(status: ACTIVE_STATUSES) }
  scope :recent, -> { order(updated_at: :desc) }

  def unfinished?
    status.in?(ACTIVE_STATUSES)
  end

  def readonly?
    persisted?
  end

  private

  def assign_task_key
    self.task_key ||= SecureRandom.uuid
  end

  def set_started_at
    self.started_at ||= Time.current
  end
end
