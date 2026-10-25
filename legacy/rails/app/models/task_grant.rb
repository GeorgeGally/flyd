class TaskGrant < ApplicationRecord
  STATUSES = %w[proposed approved expired revoked exhausted completed].freeze
  SCOPE_FIELDS = %w[
    repository_roots worktree_paths worker_adapters file_operations command_classes
    verification_commands renewal_required_actions max_concurrency budget provider_identity expires_at
  ].freeze

  belongs_to :agent_task

  has_many :worker_sessions, dependent: :restrict_with_error
  has_many :runtime_events, dependent: :nullify

  before_validation :assign_grant_key, on: :create
  before_validation :calculate_scope_digest

  validates :grant_key, :scope_digest, presence: true
  validates :expires_at, :provider_identity, presence: true
  validates :verification_commands, presence: true, if: :approved?
  validates :grant_key, uniqueness: true
  validates :status, inclusion: { in: STATUSES }
  validates :max_concurrency, numericality: { only_integer: true, greater_than: 0 }
  validates :agent_task_id, uniqueness: {
    conditions: -> { where(status: "approved") },
    message: "already has an approved grant"
  }, if: :approved?
  validate :scope_cannot_change_after_approval
  validate :approved_expiry_is_bounded

  def approved?
    status == "approved"
  end

  def readonly?
    persisted?
  end

  private

  def assign_grant_key
    self.grant_key ||= SecureRandom.uuid
  end

  def calculate_scope_digest
    scope = SCOPE_FIELDS.index_with { |field| public_send(field) }
    self.scope_digest = Digest::SHA256.hexdigest(JSON.generate(scope))
  end

  def scope_cannot_change_after_approval
    return unless persisted? && status_in_database == "approved"

    errors.add(:base, "Approved grant scope cannot change") if SCOPE_FIELDS.any? { |field| will_save_change_to_attribute?(field) }
  end

  def approved_expiry_is_bounded
    return unless approved? && expires_at.present?

    errors.add(:expires_at, "must be in the future") if expires_at <= Time.current
    errors.add(:expires_at, "cannot exceed eight hours") if expires_at > 8.hours.from_now + 5.seconds
  end
end
