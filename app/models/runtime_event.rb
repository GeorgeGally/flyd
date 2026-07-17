class RuntimeEvent < ApplicationRecord
  belongs_to :agent_task
  belongs_to :task_grant, optional: true
  belongs_to :worker_session, optional: true

  before_validation :assign_event_key, on: :create
  before_validation :set_occurred_at, on: :create

  validates :event_key, :event_type, presence: true
  validates :event_key, uniqueness: true
  validates :idempotency_key, uniqueness: true, allow_nil: true
  validates :task_revision, uniqueness: { scope: :agent_task_id }

  private

  def assign_event_key
    self.event_key ||= SecureRandom.uuid
  end

  def set_occurred_at
    self.occurred_at ||= Time.current
  end
end
